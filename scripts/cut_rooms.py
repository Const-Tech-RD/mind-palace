"""
Cuts each room out of its painting and squares it to the palace grid.

A painting shows the room as a hexagonal cutaway. The six corners of that
hexagon are measured by hand below (in a 1376 x 768 view of the painting).
The three floor corners (left, right, front) are mapped onto the 8 x 8 room
diamond of the asset spec (64 x 32 px tiles), so the cut-out can be placed on
the palace floor with its back corner at the room's origin.

Usage: python tools/cut_rooms.py <paintings dir> <output dir>
Writes <room>.webp at 2x the logical size and cut.json with, per room, the
image size and where the room's back floor corner is inside it (2x pixels).
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

VIEW = 1376  # the measurements below were taken on a view this wide
EXPORT = 2   # asset spec: export at 2x the logical size
HALF_W, HALF_H = 256, 128  # an 8 x 8 room diamond is 512 x 256 logical px

# outline: clockwise from the top corner. floor: left, right, front corners.
ROOMS = {
    'coding': ('room_natatech.jpeg', [(692, 10), (1099, 210), (1099, 524), (723, 742), (281, 499), (281, 212), (372, 168), (372, 112), (598, 12)], [(283, 497), (1097, 522), (723, 740)]),
    'music': ('room_medina.jpeg', [(710, 28), (1105, 230), (1105, 527), (722, 750), (270, 502), (270, 236)], [(272, 500), (1103, 525), (722, 748)]),
    'mailroom': ('room_mailroom.jpeg', [(690, 10), (1114, 223), (1114, 537), (700, 762), (261, 532), (261, 223)], [(263, 530), (1112, 535), (700, 760)]),
    'art': ('room_art.jpeg', [(690, 8), (1104, 233), (1104, 537), (692, 767), (270, 547), (270, 236)], [(272, 545), (1102, 535), (692, 765)]),
}

def main(src_dir, out_dir):
    meta = {}
    for room, (name, outline, floor) in ROOMS.items():
        image = Image.open(f'{src_dir}/{name}').convert('RGBA')
        k = image.width / VIEW
        outline = [(x * k, y * k) for x, y in outline]
        floor = np.array(floor, dtype=float) * k
        mask = Image.new('L', image.size, 0)
        ImageDraw.Draw(mask).polygon(outline, fill=255)
        image.putalpha(mask.filter(ImageFilter.GaussianBlur(1.2)))

        # Affine map from painting pixels to room pixels (back corner at 0, 0).
        target = np.array([(-HALF_W, HALF_H), (HALF_W, HALF_H), (0, 2 * HALF_H)], dtype=float) * EXPORT
        A = np.linalg.solve(np.c_[floor, np.ones(3)], target).T  # 2 x 3
        corners = np.c_[np.array(outline), np.ones(len(outline))] @ A.T
        min_x, min_y = np.floor(corners.min(axis=0)) - 2
        max_x, max_y = np.ceil(corners.max(axis=0)) + 2
        size = (int(max_x - min_x), int(max_y - min_y))
        # PIL wants the inverse: output pixel -> painting pixel.
        full = np.vstack([A, [0, 0, 1]])
        full[0, 2] -= min_x
        full[1, 2] -= min_y
        inverse = np.linalg.inv(full)
        cut = image.transform(size, Image.AFFINE, tuple(inverse[:2].flatten()), resample=Image.BICUBIC)
        cut.save(f'{out_dir}/{room}.webp', quality=90, method=6)
        meta[room] = {'width': size[0], 'height': size[1], 'anchorX': round(-min_x), 'anchorY': round(-min_y), 'scale': EXPORT}
        print(room, size, meta[room])
    with open(f'{out_dir}/cut.json', 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
