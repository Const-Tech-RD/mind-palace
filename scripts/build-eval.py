"""
Builds eval/<name>.jsonl for `npm run eval` from the extracted sessions and their labels.

    python3 scripts/build-eval.py [name]     # default name: draft

Each line is a chat's first two typed messages with its expected room and
project flag. The labels come from import/labels.jsonl; until a person has
reviewed that file, the eval measures agreement with a draft, not accuracy.
Sessions with no real content (confidence 0.3 or below) are left out.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1] if len(sys.argv) > 1 else 'draft'
sessions = {s['id']: s for s in map(json.loads, open(os.path.join(HERE, 'import', 'sessions.jsonl')))}
labels = [json.loads(line) for line in open(os.path.join(HERE, 'import', 'labels.jsonl')) if line.strip()]
os.makedirs(os.path.join(HERE, 'eval'), exist_ok=True)
out_path = os.path.join(HERE, 'eval', f'{name}.jsonl')
kept = 0
with open(out_path, 'w') as out:
    for label in labels:
        session = sessions.get(label['id'])
        if not session or label.get('confidence', 1) <= 0.3:
            continue
        out.write(json.dumps({
            'messages': [m['text'][:2000] for m in session['messages'][:2]],
            'room_id': label['room_id'],
            'is_project': bool(label.get('is_project')),
        }, ensure_ascii=False) + '\n')
        kept += 1
print(f'wrote {kept} cases to {out_path}')
