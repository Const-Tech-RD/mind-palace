"""
Prepares the art for the spaces between the rooms.

The floor boards, the carpet and the rug are flat pictures seen from straight
above; the canvas lays them on the isometric floor itself, so they stay
flat here. The lantern is an upright sprite. The surround is the backdrop.

Usage: python scripts/cut_ground.py <sheets dir> <surround image> <app assets dir>
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

def keyed(path):
    """Magenta removed by colour, keeping only the largest shape."""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    amount = np.minimum(r, b) - g
    alpha = np.clip((95 - amount) / 55, 0, 1)
    edge = alpha < 1
    rgb[..., 0] = np.where(edge, np.minimum(r, g + 35), r)
    rgb[..., 2] = np.where(edge, np.minimum(b, g + 35), b)
    labels, count = ndimage.label(alpha > 0.5)
    if count > 1:
        sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
        keep = ndimage.binary_dilation(labels == 1 + int(np.argmax(sizes)), iterations=3)
        alpha = np.where(keep, alpha, 0)
    image = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    return image.crop(image.getbbox())

def mirrored(tile, both=False):
    """The tile beside its mirror image (and, with `both`, above its flipped copy): it then repeats without a seam."""
    wide = Image.new('RGB', (tile.width * 2, tile.height))
    wide.paste(tile, (0, 0))
    wide.paste(tile.transpose(Image.FLIP_LEFT_RIGHT), (tile.width, 0))
    if not both:
        return wide
    full = Image.new('RGB', (wide.width, wide.height * 2))
    full.paste(wide, (0, 0))
    full.paste(wide.transpose(Image.FLIP_TOP_BOTTOM), (0, wide.height))
    return full

def main(sheets, surround, out):
    # Floor boards: the middle of the picture, away from any vignette at its edges.
    boards = Image.open(f'{sheets}/tex_floor_boards_src.jpeg').convert('RGB')
    w, h = boards.size
    tile = boards.crop((w // 8, h // 8, w - w // 8, h - h // 8)).resize((512, 512), Image.LANCZOS)
    mirrored(tile, both=True).save(f'{out}/ground/boards.webp', quality=90)

    # Carpet: only the band itself, so it can repeat along its length. (Gemini's full-size
    # download of this one came back altered, so the source is a capture of its preview.)
    carpet = np.asarray(Image.open(f'{sheets}/tex_carpet_preview.png').convert('RGB')).astype(float)
    magenta = (np.minimum(carpet[..., 0], carpet[..., 2]) - carpet[..., 1]) > 60
    rows = np.where(magenta.mean(axis=1) < 0.05)[0]
    top, bottom = int(rows.min()) + 2, int(rows.max()) - 2
    band = Image.fromarray(carpet[top:bottom].astype(np.uint8), 'RGB')
    scale = 128 / band.height
    mirrored(band.resize((int(band.width * scale), 128), Image.LANCZOS)).save(f'{out}/ground/carpet.webp', quality=92)
    print('carpet band rows', top, bottom, '->', (int(band.width * scale), 128))

    rug = keyed(f'{sheets}/item_rug_src.jpeg')
    rug.resize((640, round(640 * rug.height / rug.width)), Image.LANCZOS).save(f'{out}/ground/rug.webp', quality=92)
    lantern = keyed(f'{sheets}/item_lantern_preview.png')
    lantern.save(f'{out}/ground/lantern.png', optimize=True)
    print('rug', rug.size, 'lantern', lantern.size)

    Image.open(surround).convert('RGB').resize((2200, 1228), Image.LANCZOS).save(f'{out}/ground/surround.jpg', quality=84)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
