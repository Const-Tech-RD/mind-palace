"""
Puts your claude.ai conversations into the Mind Palace database.

Get the export first: on claude.ai, Settings > Privacy > Export data. Anthropic
emails a link to a zip. Then:

    python3 scripts/import-claude-ai.py ~/Downloads/data-....zip            # dry run
    python3 scripts/import-claude-ai.py ~/Downloads/data-....zip --apply    # backs up the database, then imports

It accepts the zip, the unzipped folder, or conversations.json itself.

- Each conversation becomes one chat with BOTH sides, yours and Claude's, and
  the real timestamps. (The Claude Code import only has your side.)
- Secrets are replaced with placeholders by the same patterns as that import.
  This is a safety net, not a guarantee.
- Imported chats arrive unsorted. By default they are marked as already looked
  at, so the app does not classify them by itself: that is one model call per
  chat. Pass --let-app-sort to have the app file them, a few at a time, the
  next time it runs; the dry run says how many calls that would be.
- Running it again replaces what it imported before (ids start with "ca-").
  Chats made in the app, and the Claude Code import, are never touched.
- Quit the app first. The database is backed up next to itself before any change.
"""
import argparse
import datetime
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.expanduser('~/Library/Application Support/mind-palace/mind-palace.sqlite')

# The redaction patterns live in the Claude Code extractor; use the same ones.
_spec = importlib.util.spec_from_file_location('extract_claude_code', os.path.join(HERE, 'extract-claude-code.py'))
_extract = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_extract)
redact = _extract.redact


def load_conversations(source):
    """The export's list of conversations, from a zip, a folder or the JSON file."""
    source = os.path.expanduser(source)
    if os.path.isdir(source):
        source = os.path.join(source, 'conversations.json')
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            names = [n for n in archive.namelist() if os.path.basename(n) == 'conversations.json']
            if not names:
                sys.exit(f'{source} has no conversations.json in it. Is it the claude.ai data export?')
            data = json.loads(archive.read(names[0]))
    else:
        if not os.path.exists(source):
            sys.exit(f'{source} does not exist.')
        with open(source) as handle:
            data = json.load(handle)
    if not isinstance(data, list):
        sys.exit(f'Expected a list of conversations, found {type(data).__name__}. Keys: {list(data)[:8] if isinstance(data, dict) else ""}')
    return data


def text_of(message):
    """A message's words: its content blocks of type text, or the plain text field."""
    parts = [block.get('text', '') for block in message.get('content') or [] if isinstance(block, dict) and block.get('type') == 'text']
    text = '\n\n'.join(p for p in parts if p and p.strip()) or (message.get('text') or '')
    # Files pasted into the message are named, not copied in.
    names = [a.get('file_name') for a in (message.get('attachments') or []) + (message.get('files') or []) if isinstance(a, dict) and a.get('file_name')]
    if names:
        text = (text + '\n\n' if text.strip() else '') + '[attached: ' + ', '.join(names) + ']'
    return text.strip()


def iso(stamp):
    """The export's timestamp as the app stores them: UTC, milliseconds, Z."""
    parsed = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    return parsed.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{parsed.microsecond // 1000:03d}Z'


def local_day(stamp, zone):
    return datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(zone).strftime('%Y-%m-%d')


def title_of(conversation, first_text, limit=60):
    name = (conversation.get('name') or '').strip() or first_text.split('\n', 1)[0].strip() or 'Untitled chat'
    name = redact(name)
    return name if len(name) <= limit else name[:limit].rsplit(' ', 1)[0].rstrip() + '…'


def plan(conversations, zone, let_app_sort):
    chats, messages, skipped = [], [], 0
    for conversation in conversations:
        rows = []
        for message in conversation.get('chat_messages') or []:
            role = {'human': 'user', 'assistant': 'assistant'}.get(message.get('sender'))
            text = text_of(message)
            if not role or not text or not message.get('created_at'):
                continue
            rows.append((message.get('uuid') or f'{len(rows)}', role, redact(text), message['created_at']))
        if not any(role == 'user' for _, role, _, _ in rows):
            skipped += 1
            continue
        rows.sort(key=lambda row: row[3])
        chat_id = 'ca-' + conversation['uuid']
        last = iso(rows[-1][3])
        chats.append({
            'id': chat_id,
            'title': title_of(conversation, next(text for _, role, text, _ in rows if role == 'user')),
            'room_id': None,
            'room_source': None,
            # Null here means "not looked at yet": the app would then classify the chat by itself.
            'classified_at': None if let_app_sort else last,
            'created_at': iso(conversation.get('created_at') or rows[0][3]),
            'last_message_at': last,
        })
        for index, (uuid, role, text, stamp) in enumerate(rows):
            messages.append((f'ca-{conversation["uuid"]}-{index}-{uuid[:8]}', chat_id, role, text, iso(stamp), local_day(stamp, zone)))
    return chats, messages, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('export', help='the export zip, its folder, or conversations.json')
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--apply', action='store_true', help='write to the database (default is a dry run)')
    parser.add_argument('--let-app-sort', action='store_true', help='let the app classify the imported chats by itself (one model call each)')
    args = parser.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f'No database at {args.db}. Open Mind Palace once first.')
    conversations = load_conversations(args.export)

    db = sqlite3.connect(args.db)
    try:
        row = db.execute("SELECT value FROM settings WHERE key = 'timezone'").fetchone()
        try:
            import zoneinfo
            zone = zoneinfo.ZoneInfo(row[0]) if row else datetime.datetime.now().astimezone().tzinfo
        except Exception:
            zone = datetime.datetime.now().astimezone().tzinfo
        chats, messages, skipped = plan(conversations, zone, args.let_app_sort)
        before = db.execute("SELECT count(*) FROM chats WHERE id LIKE 'ca-%'").fetchone()[0]
        mine = sum(1 for m in messages if m[2] == 'user')
        days = sorted(m[5] for m in messages)

        print(f'{len(conversations)} conversations in the export')
        print(f'  {len(chats)} to import, with {len(messages)} messages ({mine} yours, {len(messages) - mine} from Claude)')
        print(f'  {skipped} left out: nothing typed in them')
        if days:
            print(f'  from {days[0]} to {days[-1]}')
        print(f'  {before} chats from an earlier claude.ai import will be replaced' if before else '  nothing from an earlier claude.ai import to replace')
        if args.let_app_sort:
            print(f'  the app will classify them by itself: about {len(chats)} model calls, spread over its next runs')
        else:
            print('  they arrive unsorted and stay that way until you file them (drag onto a room, or the Mail room pigeonholes)')

        if not args.apply:
            print('\nDry run: nothing was changed. Add --apply to import.')
            return

        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = f'{args.db}.bak-{stamp}'
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        shutil.copy2(args.db, backup)
        print(f'\nbacked up to {backup}')

        db.execute('PRAGMA foreign_keys = ON')
        db.execute("DELETE FROM chats WHERE id LIKE 'ca-%'")  # their messages go with them
        db.executemany(
            'INSERT INTO chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) '
            'VALUES (:id, :title, :room_id, :room_source, :classified_at, :created_at, :last_message_at)', chats)
        db.executemany('INSERT INTO messages (id, chat_id, role, content, created_at, local_day) VALUES (?, ?, ?, ?, ?, ?)', messages)
        db.commit()
        print('imported.')
    finally:
        db.close()


if __name__ == '__main__':
    main()
