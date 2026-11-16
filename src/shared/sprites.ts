/**
 * Where a furniture sprite stands on the floor, pure. A sprite is drawn on its
 * spec canvas (docs/asset-spec.md §3) with the anchor at the front corner of its
 * footprint; here that anchor meets the front corner of the item's floor block.
 */
import { iso } from './floor'

/** One entry of src/renderer/src/assets/items/manifest.json (canvas and anchor in file px). */
export interface SpriteEntry {
  id: string
  file: string
  /** [w, d] in tiles; wall items are [width, 0]. */
  footprint: [number, number]
  canvas: [number, number]
  anchor: [number, number]
  /** File px per logical px (2: exported at double size). */
  scale: number
}

export interface SpritePlacement {
  x: number
  y: number
  anchorX: number
  anchorY: number
  scaleX: number
  scaleY: number
}

type Block = { x: number; y: number; w: number; d: number; z: number; layer: string }

/**
 * `wall` is the wall the item hangs on (or stands on a shelf on), else null.
 * Wall items are drawn for the right wall and mirrored on the left; a floor
 * item whose slot turns it round (its footprint swapped) is mirrored too.
 */
export function spritePlacement(block: Block, entry: SpriteEntry, wall: 'left' | 'right' | null): SpritePlacement {
  const [fw, fd] = entry.footprint
  const at = iso(block.x + block.w, block.y + block.d, block.z)
  // How wide the item is on this block, along the floor: a wall item's run, or the block's w + d.
  const span = wall === 'left' ? block.d : wall === 'right' ? block.w : block.w + block.d
  const size = span / (fw + fd) / entry.scale
  const turned = wall === null && fw !== fd && Math.abs(block.w - fd) < 1e-6 && Math.abs(block.d - fw) < 1e-6
  const mirrored = wall === 'left' || turned
  return {
    x: at.x,
    y: at.y,
    anchorX: entry.anchor[0] / entry.canvas[0],
    anchorY: entry.anchor[1] / entry.canvas[1],
    scaleX: mirrored ? -size : size,
    scaleY: size
  }
}
