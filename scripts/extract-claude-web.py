"""
Extracts what the person typed in their claude.ai chats into import/web-sessions.jsonl,
in the same shape as scripts/extract-claude-code.py writes (one line per chat:
id, source, name, start and end time, every typed message with its timestamp).

Answers, attachments and files are left out. Messages go through the same
cleaning and masking as the Claude Code import (keys, emails, phone and id
numbers become placeholders). The output is private: import/ is git-ignored.

    python scripts/extract-claude-web.py [path/to/conversations.json]

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


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IN
    cc = _claude_code()
    with open(source, encoding='utf8') as handle:
        conversations = json.load(handle)
    sessions, empty = [], 0
    for conversation in conversations:
        messages = []
        for message in conversation.get('chat_messages') or []:
            if message.get('sender') != 'human':
                continue
            text = cc.clean(typed_text(message, cc.text_of))
            if text and message.get('created_at'):
                messages.append({'at': message['created_at'], 'text': text})
        if not messages:
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
    sessions.sort(key=lambda s: s['startedAt'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as out:
        for session in sessions:
            out.write(json.dumps(session, ensure_ascii=False) + '\n')
    total = sum(len(s['messages']) for s in sessions)
    print(f'{len(sessions)} chats, {total} typed messages, from {sessions[0]["startedAt"][:10]} to {sessions[-1]["lastAt"][:10]}' if sessions else 'no chats')
    print(f'skipped: {empty} with nothing typed')
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
