"""
Extracts claude.ai chats into import/web-sessions.jsonl, in the same shape as
scripts/extract-claude-code.py writes (one line per chat: id, source, name,
start and end time, every typed message and answer with `role` and timestamp).

Attachments and files are left out; answers are cut like the Claude Code
import's. Everything goes through the same cleaning and masking (keys, emails,
phone and id numbers become placeholders). The output is private: import/ is
git-ignored. A chat with nothing typed by the person is skipped.

    python scripts/extract-claude-web.py [path/to/conversations.json]
    python scripts/extract-claude-web.py --self-test

The export comes from claude.ai: Settings, Privacy, Export data; the chats are
conversations.json inside conversations-000.zip.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_IN = os.path.join(ROOT, 'import', 'web', 'conversations.json')
OUT = os.path.join(ROOT, 'import', 'web-sessions.jsonl')


def _claude_code():
    spec = importlib.util.spec_from_file_location('extract_claude_code', os.path.join(HERE, 'extract-claude-code.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def typed_text(message, text_of):
    """The person's own words in one claude.ai message: `text`, else the text blocks of `content`."""
    text = (message.get('text') or '').strip()
    if text:
        return text
    return text_of(message.get('content')) or ''


def sessions_of(conversations, cc):
    """One session per conversation with something typed: the person's messages and Claude's answers, with `role`."""
    sessions, empty = [], 0
    for conversation in conversations:
        messages = []
        for message in conversation.get('chat_messages') or []:
            sender = message.get('sender')
            if sender not in ('human', 'assistant'):
                continue
            role = 'user' if sender == 'human' else 'assistant'
            text = cc.clean(typed_text(message, cc.text_of), cc.MAX_TEXT if role == 'user' else cc.ANSWER_MAX)
            if text and message.get('created_at'):
                messages.append({'at': message['created_at'], 'role': role, 'text': text})
        if not any(m['role'] == 'user' for m in messages):
            empty += 1
            continue
        messages.sort(key=lambda m: m['at'])
        sessions.append({
            'id': 'web-' + conversation['uuid'],
            'source': 'claude-web',
            'name': cc.redact((conversation.get('name') or '').strip())[:120],
            'startedAt': messages[0]['at'],
            'lastAt': messages[-1]['at'],
            'messages': messages,
        })
    return sessions, empty


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IN
    cc = _claude_code()
    with open(source, encoding='utf8') as handle:
        conversations = json.load(handle)
    sessions, empty = sessions_of(conversations, cc)
    sessions.sort(key=lambda s: s['startedAt'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as out:
        for session in sessions:
            out.write(json.dumps(session, ensure_ascii=False) + '\n')
    total = sum(len(s['messages']) for s in sessions)
    answers = sum(1 for s in sessions for m in s['messages'] if m['role'] == 'assistant')
    print(f'{len(sessions)} chats, {total - answers} typed messages and {answers} answers, from {sessions[0]["startedAt"][:10]} to {sessions[-1]["lastAt"][:10]}' if sessions else 'no chats')
    print(f'skipped: {empty} with nothing typed')
    print(f'wrote {OUT}')


def self_test():
    cc = _claude_code()
    conversations = [
        {'uuid': 'u1', 'name': 'Resin', 'chat_messages': [
            {'sender': 'human', 'created_at': '2026-10-01T10:00:00Z', 'text': 'How much is resin printing?'},
            {'sender': 'assistant', 'created_at': '2026-10-01T10:00:09Z', 'text': 'About this much. ' + 'word ' * 1000},
        ]},
        {'uuid': 'u2', 'name': 'Only Claude', 'chat_messages': [
            {'sender': 'assistant', 'created_at': '2026-10-02T10:00:00Z', 'text': 'Hello'},
        ]},
    ]
    sessions, empty = sessions_of(conversations, cc)
    assert empty == 1, empty
    assert len(sessions) == 1, sessions
    roles = [m['role'] for m in sessions[0]['messages']]
    assert roles == ['user', 'assistant'], roles
    assert len(sessions[0]['messages'][1]['text']) == cc.ANSWER_MAX
    print('self-test passed')


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        self_test()
    else:
        main()
