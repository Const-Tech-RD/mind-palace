import type { ShellTier } from '@shared/catalog'
import art from '../assets/rooms/art.jpg'
import coding from '../assets/rooms/coding.jpg'
import mailroom from '../assets/rooms/mailroom.jpg'
import music from '../assets/rooms/music.jpg'

/** The illustrated room for each catalog room. A room without a picture falls back to a plain panel. */
export const ROOM_IMAGE: Record<string, string> = { coding, music, art, mailroom }

/**
 * The room's shell tier shows in the picture itself: a bare room is dim and
 * almost colourless, a painted one has some of its colour, a finished one all of it.
 */
export const SHELL_FILTER: Record<ShellTier, string> = {
  bare: 'grayscale(0.9) brightness(0.55) contrast(0.95)',
  painted: 'grayscale(0.4) brightness(0.82)',
  finished: 'none'
}
