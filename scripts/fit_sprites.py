"""
Fits Gemini furniture sheets to the asset spec's canvases (docs/asset-spec.md §3).

Each sheet is one row of pieces on flat magenta. scripts/sprite-sheets.json
says which item each piece is, left to right. Every piece is keyed out, scaled
so its width fills the spec canvas ((w + d) x 32 px, at 2x), and stood on the
canvas's bottom edge; the canvas grows upward when a piece is taller than the
spec. The anchor is the front corner of the footprint, w x 32 px from the left.

Writes src/renderer/src/assets/items/<id>.png and manifest.json there.

    python scripts/fit_sprites.py --sheets <dir>     # fit every sheet that exists
    python scripts/fit_sprites.py --self-test
"""
import argparse
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'items')
SCALE = 2
TILE = 32  # logical px per tile along the canvas width, per footprint unit
UNIT = 32  # logical px per height unit
SPECK = 0.005  # connected shapes smaller than this share of the sheet are noise
GAP = 6  # empty columns that separate two pieces


def _cut_sprites():
    spec = importlib.util.spec_from_file_location('cut_sprites', os.path.join(HERE, 'cut_sprites.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def catalog_items():
    """Every item's footprint [w, d] (walls [width, 0]) and height, from the catalog files."""
    items = {}
    files = ['items.json', 'library.json', os.path.join('rooms', 'mailroom.json')]
    for name in files:
        with open(os.path.join(ROOT, 'catalog', name), encoding='utf8') as handle:
            data = json.load(handle)
        for item_id, d in (data.get('items') or data.get('assets') or {}).items():
            footprint = [d['width'], 0] if d['layer'] == 'wall_item' else list(d.get('footprint', [1, 1]))
            items[item_id] = {'footprint': footprint, 'height': d['height']}
    return items


class SheetError(Exception):
    pass


def pieces(sheet_rgba):
    """The pieces on a keyed sheet, left to right, as RGBA crops. Specks are dropped."""
    alpha = np.asarray(sheet_rgba)[..., 3] > 128
    labels, count = ndimage.label(alpha)
    if count == 0:
        return []
    sizes = ndimage.sum(alpha, labels, range(1, count + 1))
    keep = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s >= SPECK * alpha.size])
    columns = keep.any(axis=0)
    runs, start, empty = [], None, 0
    for x, filled in enumerate(columns):
        if filled:
            if start is None:
                start = x
            empty = 0
        elif start is not None:
            empty += 1
            if empty >= GAP:
                runs.append((start, x - empty + 1))
                start, empty = None, 0
    if start is not None:
        runs.append((start, len(columns) - empty))
    out = []
    data = np.asarray(sheet_rgba).copy()
    data[..., 3] = np.where(keep, data[..., 3], 0)
    for x0, x1 in runs:
        rows = keep[:, x0:x1].any(axis=1).nonzero()[0]
        crop = data[rows[0]:rows[-1] + 1, x0:x1]
        out.append(Image.fromarray(crop, 'RGBA'))
    return out


def fit(piece, footprint, height):
    """The piece on its spec canvas, and the manifest geometry (file px)."""
    w, d = footprint
    width = (w + d) * TILE * SCALE
    spec_height = round(((w + d) * TILE / 2 + height * UNIT) * SCALE)
    ratio = width / piece.width
    scaled = piece.resize((width, max(1, round(piece.height * ratio))), Image.LANCZOS)
    canvas_h = max(spec_height, scaled.height)
    canvas = Image.new('RGBA', (width, canvas_h), (0, 0, 0, 0))
    canvas.paste(scaled, (0, canvas_h - scaled.height), scaled)
    return canvas, {'canvas': [width, canvas_h], 'anchor': [w * TILE * SCALE, canvas_h]}


def fit_sheet(sheet_path, item_ids, items, out_dir, mirror=()):
    cut = _cut_sprites()
    keyed = cut.remove_key(Image.open(sheet_path), 'magenta')
    found = pieces(keyed)
    if len(found) != len(item_ids):
        raise SheetError(f'{os.path.basename(sheet_path)}: {len(found)} pieces, expected {len(item_ids)} ({", ".join(item_ids)})')
    entries = []
    for item_id, piece in zip(item_ids, found):
        if item_id not in items:
            raise SheetError(f'{item_id} is not in the catalog')
        if item_id in mirror:
            # Drawn with its long side the other way round from its footprint.
            piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
        canvas, geometry = fit(piece, items[item_id]['footprint'], items[item_id]['height'])
        canvas.save(os.path.join(out_dir, f'{item_id}.png'))
        entries.append({'id': item_id, 'file': f'{item_id}.png', 'footprint': items[item_id]['footprint'], **geometry, 'scale': SCALE})
    return entries


def write_manifest(out_dir, entries):
    path = os.path.join(out_dir, 'manifest.json')
    current = {}
    if os.path.exists(path):
        with open(path, encoding='utf8') as handle:
            current = {e['id']: e for e in json.load(handle)}
    for entry in entries:
        current[entry['id']] = entry
    with open(path, 'w', encoding='utf8') as handle:
        json.dump(sorted(current.values(), key=lambda e: e['id']), handle, indent=2)
        handle.write('\n')


def self_test():
    import tempfile
    sheet = Image.new('RGB', (600, 240), (255, 0, 255))
    brown = (120, 80, 50)
    for x0, x1, y0 in [(20, 120, 40), (200, 420, 100), (500, 560, 60)]:
        sheet.paste(brown, (x0, y0, x1, 220))
    sheet.paste(brown, (160, 10, 162, 12))  # a speck
    items = catalog_items()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'sheet.png')
        sheet.save(path)
        entries = fit_sheet(path, ['base_chair', 'base_desk', 'base_poster'], items, tmp)
        assert [e['canvas'][0] for e in entries] == [128, 256, 64], entries
        assert [e['anchor'][0] for e in entries] == [64, 192, 64], entries
        assert all(e['anchor'][1] == e['canvas'][1] for e in entries)
        chair = entries[0]
        assert chair['canvas'][1] >= round((32 + 1.5 * 32) * 2), chair
        assert Image.open(os.path.join(tmp, 'base_chair.png')).size == tuple(chair['canvas'])
        plain = np.asarray(Image.open(os.path.join(tmp, 'base_chair.png')))
        sheet2 = sheet.copy()
        sheet2.paste((200, 200, 200), (20, 40, 60, 220))  # make the chair asymmetric
        sheet2.save(path)
        fit_sheet(path, ['base_chair', 'base_desk', 'base_poster'], items, tmp)
        plain = np.asarray(Image.open(os.path.join(tmp, 'base_chair.png')))
        fit_sheet(path, ['base_chair', 'base_desk', 'base_poster'], items, tmp, mirror={'base_chair'})
        flipped = np.asarray(Image.open(os.path.join(tmp, 'base_chair.png')))
        assert (flipped == plain[:, ::-1]).all(), 'mirror must flip the piece left to right'
        try:
            fit_sheet(path, ['base_chair', 'base_desk'], items, tmp)
            raise AssertionError('a count mismatch must be refused')
        except SheetError:
            pass
    print('self-test passed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--sheets', default=os.path.join(os.path.dirname(ROOT), 'mind-palace-art', 'sheets'))
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    with open(os.path.join(HERE, 'sprite-sheets.json'), encoding='utf8') as handle:
        plan = json.load(handle)['sheets']
    items = catalog_items()
    os.makedirs(OUT, exist_ok=True)
    entries, failed = [], []
    for sheet in plan:
        path = os.path.join(args.sheets, sheet['file'])
        if not os.path.exists(path):
            continue
        try:
            got = fit_sheet(path, sheet['items'], items, OUT, set(sheet.get('mirror', [])))
            entries += got
            print(f"{sheet['file']}: {', '.join(e['id'] for e in got)}")
        except SheetError as error:
            failed.append(str(error))
    write_manifest(OUT, entries)
    for line in failed:
        print('REFUSED', line)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
