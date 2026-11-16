import art from '../assets/rooms/art.jpg'
import coding from '../assets/rooms/coding.jpg'
import mailroom from '../assets/rooms/mailroom.jpg'
import music from '../assets/rooms/music.jpg'
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
