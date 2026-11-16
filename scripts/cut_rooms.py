"""
Cuts each room out of its painting and sizes it for the palace floor.

A painting shows the room as a hexagonal cutaway. The six corners of that
hexagon are measured by hand below (in a 1376 x 768 view of the painting).

The cut-out is only scaled, never squashed or skewed: the painting keeps its
own proportions. It is scaled so that the room's floor is as wide as the
8 x 8 room diamond of the asset spec (512 logical px), and placed so that the
middle of the floor's left and right corners sits where the diamond's does.
The painted floor is a little deeper than the grid's 2:1 diamond; that is the
painter's angle and is left alone.

Usage: python scripts/cut_rooms.py <paintings dir> <output dir>
Writes <room>.webp at EXPORT times the logical size and cut.json with, per
room: the image size, the pixel that is the room's back corner on the grid,
the export scale, the four floor corners and the top of the walls (logical px
from that back corner).
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

VIEW = 1376   # the measurements below were taken on a view this wide
EXPORT = 3    # pixels per logical pixel: close to the paintings' own resolution
ROOM_W, HALF_H = 512, 128  # an 8 x 8 room diamond is 512 x 256 logical px

# outline: clockwise from the top corner. floor: left, right, front corners.
ROOMS = {
    'coding': ('room_natatech.jpeg', [(692, 10), (1099, 210), (1099, 524), (723, 742), (281, 499), (281, 212), (372, 168), (372, 112), (598, 12)], [(283, 497), (1097, 522), (723, 740)]),
    'music': ('room_medina.jpeg', [(710, 28), (1105, 230), (1105, 527), (722, 750), (270, 502), (270, 236)], [(272, 500), (1103, 525), (722, 748)]),
    'mailroom': ('room_mailroom.jpeg', [(690, 10), (1114, 223), (1114, 537), (700, 762), (261, 532), (261, 223)], [(263, 530), (1112, 535), (700, 760)]),
    'art': ('room_art.jpeg', [(690, 8), (1104, 233), (1104, 537), (692, 767), (270, 547), (270, 236)], [(272, 545), (1102, 535), (692, 765)]),
}

def placement(floor):
    """View px -> logical px: p -> (p - mid) * s + (0, HALF_H), with one scale for both axes."""
    left, right, _ = np.array(floor, dtype=float)
    return ROOM_W / (right[0] - left[0]), (left + right) / 2

def to_logical(point, floor):
    s, mid = placement(floor)
    return (np.array(point, dtype=float) - mid) * s + np.array([0, HALF_H])

def main(src_dir, out_dir):
    meta = {}
    for room, (name, outline, floor) in ROOMS.items():
        image = Image.open(f'{src_dir}/{name}').convert('RGBA')
        k = image.width / VIEW
        mask = Image.new('L', image.size, 0)
        ImageDraw.Draw(mask).polygon([(x * k, y * k) for x, y in outline], fill=255)
        image.putalpha(mask.filter(ImageFilter.GaussianBlur(1.5)))

        corners = np.array([to_logical(p, floor) for p in outline])
        min_x, min_y = np.floor(corners.min(axis=0)) - 1
        max_x, max_y = np.ceil(corners.max(axis=0)) + 1
        s, mid = placement(floor)
        # Crop the painting to the room's box, then resize: a plain uniform scale.
        box_view = [(np.array([lx, ly]) - np.array([0, HALF_H])) / s + mid for lx, ly in ((min_x, min_y), (max_x, max_y))]
        box = tuple(float(v * k) for v in (*box_view[0], *box_view[1]))
        size = (int(round((max_x - min_x) * EXPORT)), int(round((max_y - min_y) * EXPORT)))
        cut = image.crop(tuple(int(round(v)) for v in box)).resize(size, Image.LANCZOS)
        cut.save(f'{out_dir}/{room}.webp', quality=92, method=6)

        left, right, front = (to_logical(p, floor) for p in floor)
        back = left + right - front
        meta[room] = {
            'width': size[0], 'height': size[1],
            'anchorX': round(-min_x * EXPORT), 'anchorY': round(-min_y * EXPORT), 'scale': EXPORT,
            'floor': [[round(float(v), 1) for v in p] for p in (back, right, front, left)],
            'top': round(float(min_y), 1),
        }
        print(room, meta[room])
    with open(f'{out_dir}/cut.json', 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
