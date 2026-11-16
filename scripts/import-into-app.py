"""
Puts the extracted sessions into the Mind Palace database as chats, so the
rooms, streaks and projects show real history.

    python3 scripts/import-into-app.py            # dry run: prints what it would do
    python3 scripts/import-into-app.py --apply    # backs up the database, then imports

Reads import/sessions.jsonl (scripts/extract-claude-code.py), import/labels.jsonl
(room and project per session) and, if present, import/project-states.json
({"Project name": "active" | "paused" | "done" | "dropped"}).

- Each session becomes one chat, holding only what the person typed, with the
  real timestamps. Answers are not imported.
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
ROOMS = {'coding', 'music', 'art', 'mailroom'}
STATES = {'active', 'paused', 'done', 'dropped'}
# With no state given, a project untouched for this long is imported as paused, not active.
QUIET_DAYS = 30
# Labels at or below this confidence mark sessions with no real content.
NOISE_CONFIDENCE = 0.3


def load_jsonl(path):
    with open(path) as handle:
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
    chats, messages, groups = [], [], collections.defaultdict(list)
    for session in sessions:
        label = by_id.get(session['id'])
        # Scheduled runs, tests and greetings: not conversations worth a chat.
        if label and label.get('confidence', 1) <= NOISE_CONFIDENCE:
            continue
        room = label['room_id'] if label and label.get('room_id') in ROOMS else None
        chat_id = 'cc-' + session['id']
        chats.append({
            'id': chat_id,
            'title': title_of(session['messages'][0]['text'], label),
            'room_id': room,
            'room_source': 'model' if room else None,
            'classified_at': now if room else None,
            'created_at': session['startedAt'],
            'last_message_at': session['lastAt'],
        })
        for index, message in enumerate(session['messages']):
            messages.append((f'{chat_id}-{index:04d}', chat_id, 'user', message['text'], message['at']))
        if label and label.get('is_project') and label.get('project'):
            groups[label['project'].strip()].append((session, room))

    projects, links, completions = [], [], []
    quiet_before = (datetime.datetime.fromisoformat(now.replace('Z', '+00:00')) - datetime.timedelta(days=QUIET_DAYS)).isoformat()
    for name, members in sorted(groups.items()):
        members.sort(key=lambda pair: pair[0]['startedAt'])
        rooms = collections.Counter(room for _, room in members if room)
        room = rooms.most_common(1)[0][0] if rooms else 'mailroom'
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
    return chats, messages, projects, links, completions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--db', default=DEFAULT_DB)
    args = parser.parse_args()

    sessions = load_jsonl(os.path.join(HERE, 'import', 'sessions.jsonl'))
    labels_path = os.path.join(HERE, 'import', 'labels.jsonl')
    labels = load_jsonl(labels_path) if os.path.exists(labels_path) else []
    states_path = os.path.join(HERE, 'import', 'project-states.json')
    states = json.load(open(states_path)) if os.path.exists(states_path) else {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    chats, messages, projects, links, completions = plan(sessions, labels, states, now)

    rooms = collections.Counter(chat['room_id'] or '(unsorted)' for chat in chats)
    print(f'{len(chats)} chats, {len(messages)} messages, {len(projects)} projects, {len(links)} chat links')
    print('chats per room:', dict(rooms))
    print('projects by state:', dict(collections.Counter(p['state'] for p in projects)))
    if not labels:
        print('note: no import/labels.jsonl, so chats are imported unsorted and without projects')
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
        # Replace an earlier import. Order matters: projects reference chats.
        db.execute("DELETE FROM projects WHERE id LIKE 'ccp-%'")
        db.execute("DELETE FROM chats WHERE id LIKE 'cc-%'")
        db.executemany(
            'INSERT INTO chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) '
            'VALUES (:id, :title, :room_id, :room_source, :classified_at, :created_at, :last_message_at)', chats)
        db.executemany('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)', messages)
        db.executemany(
            'INSERT INTO projects (id, title, room_id, origin_chat_id, state, last_activity_at, created_at, closed_at) '
            'VALUES (:id, :title, :room_id, :origin_chat_id, :state, :last_activity_at, :created_at, :closed_at)', projects)
        db.executemany('INSERT INTO project_chats (project_id, chat_id) VALUES (?, ?)', links)
        # One counted completion per room per local day, as the app does.
        counted_days = {(room, day) for room, day in db.execute('SELECT room_id, local_day FROM goal_completions WHERE counted = 1')}
        for project_id, room, closed in sorted(completions, key=lambda row: row[2]):
            day = local_day(closed, tz_name)
            counted = (room, day) not in counted_days
            counted_days.add((room, day))
            db.execute('INSERT INTO goal_completions (id, project_id, room_id, local_day, counted) VALUES (?, ?, ?, ?, ?)',
                       ('ccg-' + project_id[4:], project_id, room, day, 1 if counted else 0))
        db.commit()
        print('imported.')
    finally:
        db.close()


if __name__ == '__main__':
    main()
