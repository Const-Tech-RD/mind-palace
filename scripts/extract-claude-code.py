"""
Extracts Claude Code sessions into import/sessions.jsonl.

One line per session: id, project folder, start and end time, every message
the person wrote and every answer's text (each with `role` and timestamp), and
the files the session edited (`files`: path -> number of edits). Tool calls and
results, slash-command wrappers, system reminders, hand-over briefs and subagent
side chains are left out, and credentials, emails, phone and id numbers are
replaced with placeholders. Answers are cut to ANSWER_MAX characters.
Read-only on ~/.claude. The output is private: import/ is git-ignored.

    python3 scripts/extract-claude-code.py
    python3 scripts/extract-claude-code.py --self-test
"""
import collections
import glob
import json
import os
import re
import sys

ROOT = os.path.expanduser('~/.claude/projects')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'import', 'sessions.jsonl')

# Sessions created by this app's own chats and tests are not the person's history.
SKIP_DIR = re.compile(r'mind-palace-e2e|mind-palace-claude-sessions')
NOISE = re.compile(
    r'^\s*(<command-|<local-command|<system-reminder|<task-notification|<user-prompt-submit-hook|<bash-|'
    r'Caveat: The messages below|\[Request interrupted|This session is being continued|<agent-message|'
    r'\[SYSTEM NOTIFICATION|<pasted_content|<ide_|<side-sessions-event|<ci-monitor-event)',
    re.I,
)
TAGS = re.compile(r'<(system-reminder|ide_[a-z_]+|pasted_content[^>]*|artifact-view-context[^>]*)>.*?</\1[^>]*>', re.S)
# A brief another session generated when it handed work over: not typed by the person.
HANDOFF = re.compile(r'^\s*Background \(from the session that started this one\)', re.I)
MAX_TEXT = 1500
# Claude's answers carry the plans and decisions; long enough for a plan, short enough for the database.
ANSWER_MAX = 4000
# Tool calls that change a file: their `file_path` tells which folder a session worked in.
EDIT_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'}

# Things that must not be copied out of the transcripts. Each match becomes a
# placeholder naming what was there. This is a safety net, not a guarantee:
# anything it misses is still in the original transcripts and should be rotated.
REDACTIONS = [
    (re.compile(r'\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?)://\S+', re.I), '[connection string removed]'),
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----', re.S), '[private key removed]'),
    (re.compile(r'\b(?:sk|pk|rk|ghp|gho|github_pat|xox[abprs]|AKIA|AIza|shpat|EAA)[A-Za-z0-9_\-]{12,}'), '[key removed]'),
    (re.compile(r'\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}(?:\.[A-Za-z0-9_\-]+)?'), '[token removed]'),
    (re.compile(r'(?i)\b(pass(?:word)?|contrase[ñn]a|clave|pwd|secret|token|api[_ -]?key|bearer)\b(\s*(?:es|is)?\s*[:=]?\s*)(\S{4,})'), r'\1\2[removed]'),
    (re.compile(r'\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+'), '[email removed]'),
    (re.compile(r'\b\d{3}-?\d{7}-?\d\b'), '[id number removed]'),
    (re.compile(r'(?<!\d)(?:\+?1[ .-]?)?\(?8[024]9\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)'), '[phone removed]'),
    (re.compile(r'\b(?:\d[ -]?){13,19}\b'), '[number removed]'),
    (re.compile(r'\b[A-Za-z0-9_\-+/=]{40,}\b'), '[long token removed]'),
]


def redact(text):
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def text_of(content):
    """The typed text of a user message, or None if it is not one."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
            return None
        parts = [b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text']
        return '\n'.join(p for p in parts if p) or None
    return None


def clean(text, limit=MAX_TEXT):
    text = TAGS.sub('', text).strip()
    if not text or NOISE.match(text) or HANDOFF.match(text):
        return None
    return redact(text)[:limit]


def read_session(path):
    """A session's id, folder, messages (the person's and Claude's answers, with `role`) and files edited."""
    messages, cwd, session_id, files = [], None, None, collections.Counter()
    with open(path, encoding='utf8', errors='replace') as handle:
        for line in handle:
            if '"type":"user"' not in line and '"type": "user"' not in line                     and '"type":"assistant"' not in line and '"type": "assistant"' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            kind = row.get('type')
            if kind not in ('user', 'assistant') or row.get('isSidechain') or row.get('isMeta'):
                continue
            cwd = cwd or row.get('cwd')
            session_id = session_id or row.get('sessionId')
            content = (row.get('message') or {}).get('content')
            if kind == 'assistant' and isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'tool_use' and block.get('name') in EDIT_TOOLS:
                        target = (block.get('input') or {}).get('file_path') or (block.get('input') or {}).get('notebook_path')
                        if isinstance(target, str) and target:
                            files[target] += 1
            raw = text_of(content)
            text = clean(raw, MAX_TEXT if kind == 'user' else ANSWER_MAX) if raw else None
            if text and row.get('timestamp'):
                messages.append({'at': row['timestamp'], 'role': kind, 'text': text})
    return session_id, cwd, messages, dict(files)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sessions, skipped, per_project = [], collections.Counter(), collections.Counter()
    for folder in sorted(os.listdir(ROOT)):
        directory = os.path.join(ROOT, folder)
        if not os.path.isdir(directory):
            continue
        for path in sorted(glob.glob(os.path.join(directory, '*.jsonl'))):
            if SKIP_DIR.search(folder):
                skipped['created by this app'] += 1
                continue
            session_id, cwd, messages, files = read_session(path)
            if not any(m['role'] == 'user' for m in messages):
                skipped['nothing typed'] += 1
                continue
            messages.sort(key=lambda m: m['at'])
            project = cwd or folder
            sessions.append({
                'id': session_id or os.path.splitext(os.path.basename(path))[0],
                'source': 'claude-code',
                'cwd': project,
                'startedAt': messages[0]['at'],
                'lastAt': messages[-1]['at'],
                'messages': messages,
                'files': files,
            })
            per_project[project] += 1
    # The same session id can be on disk twice (a resumed copy): keep the fuller one.
    fullest = {}
    for session in sessions:
        kept = fullest.get(session['id'])
        if kept is None or len(session['messages']) > len(kept['messages']):
            fullest[session['id']] = session
    skipped['duplicate id'] += len(sessions) - len(fullest)
    sessions = sorted(fullest.values(), key=lambda s: s['startedAt'])
    with open(OUT, 'w', encoding='utf8') as out:
        for session in sessions:
            out.write(json.dumps(session, ensure_ascii=False) + '\n')

    total = sum(len(s['messages']) for s in sessions)
    days = sorted({m['at'][:10] for s in sessions for m in s['messages']})
    answers = sum(1 for s in sessions for m in s['messages'] if m['role'] == 'assistant')
    print(f'{len(sessions)} sessions, {total - answers} typed messages and {answers} answers, {len(days)} distinct UTC days')
    if days:
        print(f'from {days[0]} to {days[-1]}')
    print('skipped:', dict(skipped))
    print('wrote', OUT)
    return sessions, per_project


def self_test():
    import tempfile
    key = 'sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0'
    rows = [
        {'type': 'user', 'sessionId': 's1', 'cwd': 'C:/a', 'timestamp': '2026-10-01T10:00:00Z',
         'message': {'content': 'Please fix the login page'}},
        {'type': 'assistant', 'timestamp': '2026-10-01T10:00:05Z', 'message': {'content': [
            {'type': 'text', 'text': 'Done. I used ' + key + '. ' + 'word ' * 1000},
            {'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': 'C:/a/x.ts'}},
            {'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': 'C:/a/x.ts'}},
            {'type': 'tool_use', 'name': 'Write', 'input': {'file_path': 'C:/a/y.md'}},
            {'type': 'tool_use', 'name': 'Read', 'input': {'file_path': 'C:/a/z.ts'}}]}},
        {'type': 'user', 'timestamp': '2026-10-01T10:00:06Z', 'message': {'content': [
            {'type': 'tool_result', 'content': 'ok'}]}},
        {'type': 'assistant', 'isSidechain': True, 'timestamp': '2026-10-01T10:00:07Z', 'message': {'content': [
            {'type': 'text', 'text': 'side chain'},
            {'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': 'C:/a/side.ts'}}]}},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 's1.jsonl')
        with open(path, 'w', encoding='utf8') as handle:
            for row in rows:
                handle.write(json.dumps(row) + '\n')
        session_id, cwd, messages, files = read_session(path)
    assert session_id == 's1' and cwd == 'C:/a', (session_id, cwd)
    assert [m['role'] for m in messages] == ['user', 'assistant'], messages
    answer = messages[1]['text']
    assert key not in answer and '[key removed]' in answer, answer[:80]
    assert len(answer) == ANSWER_MAX, len(answer)
    assert len(messages[0]['text']) <= MAX_TEXT
    assert files == {'C:/a/x.ts': 2, 'C:/a/y.md': 1}, files
    assert SKIP_DIR.search('C--Users-Claudio-Sanchez-AppData-Roaming-mind-palace-claude-sessions')
    print('self-test passed')


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        self_test()
    else:
        main()
