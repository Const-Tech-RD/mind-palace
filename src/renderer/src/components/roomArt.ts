import art from '../assets/rooms/art.jpg'
import coding from '../assets/rooms/coding.jpg'
import mailroom from '../assets/rooms/mailroom.jpg'
import music from '../assets/rooms/music.jpg'
import artCut from '../assets/rooms/cut/art.webp'
import codingCut from '../assets/rooms/cut/coding.webp'
import mailroomCut from '../assets/rooms/cut/mailroom.webp'
import musicCut from '../assets/rooms/cut/music.webp'
import helperArt from '../assets/characters/helper_art.png'
import helperCoding from '../assets/characters/helper_coding.png'
import helperMailroom from '../assets/characters/helper_mailroom.png'
import helperMusic from '../assets/characters/helper_music.png'
import natoSit from '../assets/characters/nato_sit.png'
import natoWalk1 from '../assets/characters/nato_walk_1.png'
import natoWalk2 from '../assets/characters/nato_walk_2.png'
import natoWalk3 from '../assets/characters/nato_walk_3.png'
import natoWalk4 from '../assets/characters/nato_walk_4.png'
import lobby from '../assets/items/lobby.png'

/** The whole painting of each room, shown as the header picture beside a room. */
export const ROOM_IMAGE: Record<string, string> = { coding, music, art, mailroom }

/**
 * Each room cut out of its painting by `scripts/cut_rooms.py`, which prints
 * these numbers. The cut-out is only scaled, never squashed or skewed, so the
 * painting keeps its own proportions; its floor is as wide as the grid's room
 * diamond but a little deeper.
 *
 * `anchorX`/`anchorY` is the pixel inside the cut-out that sits on the room's
 * back corner of the grid, and `scale` is pixels per logical pixel. `floor` is
 * the painted floor's corners (back, right, front, left) and `top` the top of
 * the walls, in logical pixels from that back corner. `nato` and `helper` are
 * free spots on the painted floor, in room tiles, picked by eye.
 */
type Point = readonly [number, number]
export const ROOM_CUT: Record<
  string,
  { url: string; anchorX: number; anchorY: number; scale: number; floor: readonly [Point, Point, Point, Point]; top: number; nato: Point; helper: Point }
> = {
  coding: { url: codingCut, anchorX: 777, anchorY: 564, scale: 3, floor: [[-20.8, -17], [256, 135.9], [20.8, 273], [-256, 120.1]], top: -188, nato: [4.09, 2.22], helper: [2.81, 4.73] },
  music: { url: musicCut, anchorX: 777, anchorY: 516, scale: 3, floor: [[-21.3, -17.1], [256, 135.7], [21.3, 273.1], [-256, 120.3]], top: -172, nato: [3.59, 4.57], helper: [5.89, 4.98] },
  mailroom: { url: mailroomCut, anchorX: 777, anchorY: 567, scale: 3, floor: [[-7.5, -9.2], [256, 129.5], [7.5, 265.2], [-256, 126.5]], top: -189, nato: [5.48, 4.04], helper: [6.68, 2.65] },
  art: { url: artCut, anchorX: 777, anchorY: 606, scale: 3, floor: [[-3.1, -10.8], [256, 124.9], [3.1, 266.8], [-256, 131.1]], top: -202, nato: [4.68, 4.96], helper: [3.31, 6.39] }
}

/**
 * Sprites cut from generated sheets by `scripts/cut_sprites.py`. Within a set
 * every picture has the same canvas, with the feet on the bottom edge and
 * centred, so frames swap without the figure jumping.
 */
export const NATO_FRAMES = {
  /** One stride: step, pass, step, pass. The last frame, feet together, is also the standing pose. */
  walk: [natoWalk1, natoWalk2, natoWalk3, natoWalk4],
  sit: natoSit,
  /** How tall the figure is inside its canvas, in pixels. */
  figureHeight: 420
}
/** Each room's own helper. */
export const HELPER_SPRITE: Record<string, string> = { coding: helperCoding, music: helperMusic, art: helperArt, mailroom: helperMailroom }
export const HELPER_FIGURE_HEIGHT = 320
/** The centrepiece of the lobby, where the hallways cross. */
export const LOBBY_SPRITE = { url: lobby, width: 332, height: 366 }
