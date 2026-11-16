"""
Turns the generated sheets into the sprites the app uses.

Each sheet is one row of figures on a flat key colour (magenta or green).
The key is removed by colour, the row is split where the columns are empty,
and every figure is written at the same scale with its feet on the bottom
edge and centred, so frames can be swapped without the figure jumping.

Usage: python tools/cut_sprites.py <sheets dir> <app assets dir>
"""
import sys
import numpy as np
from scipy import ndimage
from PIL import Image

def remove_key(image, key):
    """Alpha from how far a pixel is from the key colour family; also takes the key's tint off the edges."""
    rgb = np.asarray(image.convert('RGB')).astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    amount = np.minimum(r, b) - g if key == 'magenta' else g - np.maximum(r, b)
    alpha = np.clip((95 - amount) / 55, 0, 1)
    edge = (alpha < 1)
    if key == 'magenta':
        limit = g + 35
        rgb[..., 0] = np.where(edge, np.minimum(r, limit), r)
        rgb[..., 2] = np.where(edge, np.minimum(b, limit), b)
    else:
        rgb[..., 1] = np.where(edge, np.minimum(g, np.maximum(r, b) + 25), g)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def columns(alpha, expected):
    """Splits the row into figures at empty columns; falls back to the emptiest columns between equal parts."""
    filled = (alpha > 40).sum(axis=0)
    solid = filled > 3
    spans, start = [], None
    for x, on in enumerate(solid):
        if on and start is None:
            start = x
        if not on and start is not None:
            if x - start > 40:
                spans.append((start, x))
            start = None
    if start is not None:
        spans.append((start, len(solid)))
    if len(spans) == expected:
        return spans
    left, right = np.argmax(solid), len(solid) - np.argmax(solid[::-1])
    width = (right - left) / expected
    cuts = [left]
    for i in range(1, expected):
        centre = int(left + width * i)
        window = filled[centre - 60:centre + 60]
        cuts.append(centre - 60 + int(np.argmin(window)))
    cuts.append(right)
    return list(zip(cuts[:-1], cuts[1:]))

def figures(path, key, expected):
    image = remove_key(Image.open(path), key)
    alpha = np.asarray(image)[..., 3]
    out = []
    for x0, x1 in columns(alpha, expected):
        part = image.crop((x0, 0, x1, image.height))
        # Keep only the figure itself: the largest connected shape. This drops a painted
        # shadow under the feet and the faint stray pieces the generator leaves on the key colour.
        data = np.asarray(part).copy()
        labels, count = ndimage.label(data[..., 3] > 120)
        if count > 1:
            sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
            keep = ndimage.binary_dilation(labels == 1 + int(np.argmax(sizes)), iterations=3)
            data[..., 3] = np.where(keep, data[..., 3], 0)
        part = Image.fromarray(data, 'RGBA')
        out.append(part.crop(part.getbbox()))
    return out

def save_set(parts, names, out_dir, height, pad=6):
    """All figures on canvases of one size, scaled together, feet on the bottom edge, centred."""
    scale = height / max(p.height for p in parts)
    sized = [p.resize((max(1, round(p.width * scale)), max(1, round(p.height * scale))), Image.LANCZOS) for p in parts]
    width = max(s.width for s in sized) + pad * 2
    for part, name in zip(sized, names):
        canvas = Image.new('RGBA', (width, height + pad), (0, 0, 0, 0))
        canvas.alpha_composite(part, ((width - part.width) // 2, height + pad - part.height))
        canvas.save(f'{out_dir}/{name}.png', optimize=True)
        print(name, canvas.size)

def main(sheets, out):
    nato = figures(f'{sheets}/sheet_nato_walk_src.jpeg', 'magenta', 5)
    # The four walk frames share a scale; the seated pose is shorter and keeps the same scale.
    save_set(nato, ['nato_walk_1', 'nato_walk_2', 'nato_walk_3', 'nato_walk_4', 'nato_sit'], f'{out}/characters', 420)
    helpers = figures(f'{sheets}/sheet_helpers_src.jpeg', 'green', 4)
    save_set(helpers, ['helper_coding', 'helper_music', 'helper_art', 'helper_mailroom'], f'{out}/characters', 320)
    lobby = figures(f'{sheets}/item_lobby_plinth_src.jpeg', 'magenta', 1)
    save_set(lobby, ['lobby'], f'{out}/items', 360)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
