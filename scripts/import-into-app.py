"""
Puts the extracted sessions into the Mind Palace database as chats, so the
rooms, streaks and projects show real history.

    python3 scripts/import-into-app.py            # dry run: prints what it would do
    python3 scripts/import-into-app.py --apply    # backs up the database, then imports

Reads import/sessions.jsonl (scripts/extract-claude-code.py), import/web-sessions.jsonl
(scripts/extract-claude-web.py, if present), import/labels.jsonl
(project per session; any room in it is ignored) and, if present,
import/project-states.json ({"Project name": "active" | "paused" | "done" | "dropped"}).

- Each session becomes one chat in the Mail room, holding only what the person
  typed, with the real timestamps. Answers are not imported. Rooms are made
  later in the app: "Find my rooms" sorts the chats into areas of life, and
  each area with 3 or more chats is offered as a room to materialise.
- Chats are stamped as classified, so the app does not re-classify each one.
- Sessions that share a project name become one tracked project.
- Running it again replaces what it imported before; chats made in the app are
  never touched (imported rows have ids starting with "cc-" / "ccp-").
- Quit the app first. The database is backed up next to itself before any change.
"""
import argparse
import collections
import datetime
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.expanduser('~/Library/Application Support/mind-palace/mind-palace.sqlite')
MAIL_ROOM = 'mailroom'
STATES = {'active', 'paused', 'done', 'dropped'}
# With no state given, a project untouched for this long is imported as paused, not active.
QUIET_DAYS = 30
# Labels at or below this confidence mark sessions with no real content.
NOISE_CONFIDENCE = 0.3


def load_jsonl(path):
    with open(path, encoding='utf8') as handle:
        return [json.loads(line) for line in handle if line.strip()]


FILE_MENTION = re.compile(r'@"[^"]*"|@\S+|\[[a-z ]*removed\]')


def shorten(line, limit=60):
    if len(line) <= limit:
        return line
    cut = line[:limit]
    space = cut.rfind(' ')
    return (cut[:space] if space > limit / 2 else cut).rstrip() + '…'


def title_of(text, label=None, limit=60):
    """
    A chat title: the first typed line without file mentions. A project chat is
    prefixed with its project so related chats read as a group, and a first
    line that says nothing ("si", a bare file path) falls back to the label's
    short description of the session.
    """
    line = (text.strip().splitlines() or [''])[0]
    line = re.sub(r'\s+', ' ', FILE_MENTION.sub(' ', line)).strip(' :,.-')
    if len(line) < 12 and label and label.get('why'):
        line = label['why'].strip().rstrip('.')
        line = line[:1].upper() + line[1:]
    project = label.get('project') if label and label.get('is_project') else None
    if project:
        return shorten(f'{project.strip()} · {line}' if line else project.strip(), limit)
    return shorten(line, limit) if line else 'New chat'


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:60] or 'project'


def local_day(iso, tz_name):
    moment = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    try:
        from zoneinfo import ZoneInfo
        return moment.astimezone(ZoneInfo(tz_name)).date().isoformat()
    except Exception:
        return moment.date().isoformat()


def plan(sessions, labels, states, now):
    by_id = {label['id']: label for label in labels}
    chats, messages, files, groups = [], [], [], collections.defaultdict(list)
    for session in sessions:
        label = by_id.get(session['id'])
        # Scheduled runs, tests and greetings: not conversations worth a chat.
        if label and label.get('confidence', 1) <= NOISE_CONFIDENCE:
            continue
        room = MAIL_ROOM
        chat_id = 'cc-' + session['id']
        chats.append({
            'id': chat_id,
            # claude.ai chats carry their own name; Claude Code sessions are titled from the first message.
            'title': session.get('name') if session.get('name') and not label else title_of(session['messages'][0]['text'], label),
            'room_id': room,
            'room_source': 'model',
            'classified_at': now,
            'created_at': session['startedAt'],
            'last_message_at': session['lastAt'],
            # Where a Claude Code session ran; claude.ai chats have none.
            'cwd': session.get('cwd') if session.get('source') == 'claude-code' else None,
        })
        for index, message in enumerate(session['messages']):
            # Lines from before answers were extracted carry no role: they are the person's.
            messages.append((f'{chat_id}-{index:04d}', chat_id, message.get('role', 'user'), message['text'], message['at']))
        for path, edits in (session.get('files') or {}).items():
            files.append((chat_id, path, edits))
        if label and label.get('is_project') and label.get('project'):
            groups[label['project'].strip()].append((session, room))

    projects, links, completions = [], [], []
    quiet_before = (datetime.datetime.fromisoformat(now.replace('Z', '+00:00')) - datetime.timedelta(days=QUIET_DAYS)).isoformat()
    for name, members in sorted(groups.items()):
        members.sort(key=lambda pair: pair[0]['startedAt'])
        room = MAIL_ROOM
        last = max(session['lastAt'] for session, _ in members)
        state = states.get(name)
        if state not in STATES:
            state = 'paused' if last.replace('Z', '+00:00') < quiet_before else 'active'
        project_id = 'ccp-' + slug(name)
        projects.append({
            'id': project_id, 'title': name, 'room_id': room, 'origin_chat_id': 'cc-' + members[0][0]['id'],
            'state': state, 'last_activity_at': last, 'created_at': members[0][0]['startedAt'],
            'closed_at': last if state in ('done', 'dropped') else None,
        })
        for session, _ in members:
            links.append((project_id, 'cc-' + session['id']))
        if state == 'done':
            completions.append((project_id, room, last))
    return chats, messages, files, projects, links, completions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--db', default=DEFAULT_DB)
    args = parser.parse_args()

    sessions = load_jsonl(os.path.join(HERE, 'import', 'sessions.jsonl'))
    web_path = os.path.join(HERE, 'import', 'web-sessions.jsonl')
    if os.path.exists(web_path):
        sessions += load_jsonl(web_path)
    labels_path = os.path.join(HERE, 'import', 'labels.jsonl')
    labels = load_jsonl(labels_path) if os.path.exists(labels_path) else []
    states_path = os.path.join(HERE, 'import', 'project-states.json')
    states = json.load(open(states_path)) if os.path.exists(states_path) else {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    chats, messages, files, projects, links, completions = plan(sessions, labels, states, now)

    rooms = collections.Counter(chat['room_id'] or '(unsorted)' for chat in chats)
    answers = sum(1 for m in messages if m[2] == 'assistant')
    print(f'{len(chats)} chats, {len(messages) - answers} typed messages and {answers} answers, '
          f'{len(files)} files edited, {len(projects)} projects, {len(links)} chat links')
    print('chats per room:', dict(rooms))
    print('projects by state:', dict(collections.Counter(p['state'] for p in projects)))
    if not labels:
        print('note: no import/labels.jsonl, so chats are imported without projects')
    if not args.apply:
        print('dry run: nothing written. Add --apply to import.')
        return
    if not os.path.exists(args.db):
        sys.exit(f'No database at {args.db}. Start the app once so it creates it, then quit it.')

    db = sqlite3.connect(args.db, timeout=2)
    try:
        db.execute('PRAGMA foreign_keys = ON')
        try:
            db.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError:
            sys.exit('The database is in use. Quit Mind Palace (from the tray) and try again.')
        db.execute('ROLLBACK')

        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup_path = f'{args.db}.bak-{stamp}'
        backup = sqlite3.connect(backup_path)
        db.backup(backup)
        backup.close()
        print('backup:', backup_path)

        tz_row = db.execute("SELECT value FROM settings WHERE key = 'timezone'").fetchone()
        tz_name = tz_row[0] if tz_row else 'UTC'

        db.execute('BEGIN IMMEDIATE')
        # What the app has done with earlier imported rows survives a re-import:
        # a chat's room and area (rooms the person made, "Find my rooms"), its
        # project answer, a project's room and state, and goals and links made in the app.
        kept_chats = db.execute(
            "SELECT id, room_id, room_source, area, area_name, classified_at, suggested_project_id, project_dismissed_at "
            "FROM chats WHERE id LIKE 'cc-%'").fetchall()
        kept_projects = db.execute(
            "SELECT id, room_id, state, closed_at, snoozed_until, next_step FROM projects WHERE id LIKE 'ccp-%'").fetchall()
        kept_goals = db.execute(
            "SELECT id, project_id, room_id, local_day FROM goal_completions WHERE project_id LIKE 'ccp-%' AND id NOT LIKE 'ccg-%'").fetchall()
        kept_links = db.execute(
            "SELECT project_id, chat_id FROM project_chats WHERE project_id LIKE 'ccp-%' OR chat_id LIKE 'cc-%'").fetchall()
        # Project progress made in the app: milestones, proposals, sweep answers and folders.
        # (Chat digests are not kept: the app rebuilds them from the fresh messages.)
        kept_folders = db.execute(
            "SELECT id, folder, git_root, folder_source, swept_at FROM projects WHERE id LIKE 'ccp-%'").fetchall()
        milestone_cols = ('id, project_id, title, original_title, position, status, done_on, evidence, evidence_ref, '
                          'edited, status_by_user, deleted_at, created_at')
        kept_milestones = db.execute(
            f"SELECT {milestone_cols} FROM milestones WHERE project_id LIKE 'ccp-%'").fetchall()
        proposal_cols = 'id, project_id, kind, milestone_id, title, after_id, evidence, evidence_ref, done_on, answered, created_at'
        kept_proposals = db.execute(
            f"SELECT {proposal_cols} FROM milestone_proposals WHERE project_id LIKE 'ccp-%'").fetchall()
        kept_dismissals = db.execute(
            "SELECT project_id, chat_id FROM sweep_dismissals WHERE project_id LIKE 'ccp-%' OR chat_id LIKE 'cc-%'").fetchall()
        # Replace an earlier import. Order matters: projects reference chats.
        db.execute("DELETE FROM projects WHERE id LIKE 'ccp-%'")
        db.execute("DELETE FROM chats WHERE id LIKE 'cc-%'")
        db.executemany(
            'INSERT INTO chats (id, title, room_id, room_source, classified_at, created_at, last_message_at, cwd) '
            'VALUES (:id, :title, :room_id, :room_source, :classified_at, :created_at, :last_message_at, :cwd)', chats)
        db.executemany('INSERT INTO chat_files (chat_id, path, edits) VALUES (?, ?, ?)', files)
        db.executemany('INSERT INTO messages (id, chat_id, role, content, created_at, local_day) VALUES (?, ?, ?, ?, ?, ?)',
                       [(*row, local_day(row[4], tz_name)) for row in messages])
        db.executemany(
            'INSERT INTO projects (id, title, room_id, origin_chat_id, state, last_activity_at, created_at, closed_at) '
            'VALUES (:id, :title, :room_id, :origin_chat_id, :state, :last_activity_at, :created_at, :closed_at)', projects)
        db.executemany('INSERT INTO project_chats (project_id, chat_id) VALUES (?, ?)', links)
        # Every completion is stored; the app counts at most one per room per local day.
        for project_id, room, closed in sorted(completions, key=lambda row: row[2]):
            db.execute('INSERT INTO goal_completions (id, project_id, room_id, local_day) VALUES (?, ?, ?, ?)',
                       ('ccg-' + project_id[4:], project_id, room, local_day(closed, tz_name)))
        db.executemany(
            'UPDATE chats SET room_id = ?, room_source = ?, area = ?, area_name = ?, classified_at = ?, '
            'suggested_project_id = ?, project_dismissed_at = ? WHERE id = ?',
            [(*row[1:], row[0]) for row in kept_chats])
        db.executemany(
            'UPDATE projects SET room_id = ?, state = ?, closed_at = ?, snoozed_until = ?, next_step = ? WHERE id = ?',
            [(*row[1:], row[0]) for row in kept_projects])
        db.executemany(
            'INSERT OR IGNORE INTO goal_completions (id, project_id, room_id, local_day) '
            'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?)',
            [(*row, row[1]) for row in kept_goals])
        db.executemany(
            'INSERT OR IGNORE INTO project_chats (project_id, chat_id) '
            'SELECT ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?) AND EXISTS (SELECT 1 FROM chats WHERE id = ?)',
            [(p, c, p, c) for p, c in kept_links])
        db.executemany(
            'UPDATE projects SET folder = ?, git_root = ?, folder_source = ?, swept_at = ? WHERE id = ?',
            [(*row[1:], row[0]) for row in kept_folders])
        db.executemany(
            f'INSERT OR IGNORE INTO milestones ({milestone_cols}) '
            'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?)',
            [(*row, row[1]) for row in kept_milestones])
        db.executemany(
            f'INSERT OR IGNORE INTO milestone_proposals ({proposal_cols}) '
            'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?) '
            'AND (? IS NULL OR EXISTS (SELECT 1 FROM milestones WHERE id = ?))',
            [(*row, row[1], row[3], row[3]) for row in kept_proposals])
        db.executemany(
            'INSERT OR IGNORE INTO sweep_dismissals (project_id, chat_id) '
            'SELECT ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?) AND EXISTS (SELECT 1 FROM chats WHERE id = ?)',
            [(p, c, p, c) for p, c in kept_dismissals])
        db.commit()
        print(f'imported. kept from before: {len(kept_chats)} chats, {len(kept_projects)} projects, {len(kept_goals)} goals made in the app, '
              f'{len(kept_milestones)} milestones, {len(kept_proposals)} proposals, {len(kept_dismissals)} sweep answers')
    finally:
        db.close()


if __name__ == '__main__':
    main()
