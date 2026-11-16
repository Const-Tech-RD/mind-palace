/**
 * Colours for code that cannot use CSS (the PixiJS canvas). Every colour is a
 * `--mp-*` token in styles.css, so a theme swaps the tokens and nothing here.
 */

import { parseCssColor } from '@shared/color'

export { parseCssColor }

export function readToken(name: string, root: Element = document.documentElement): number {
  try {
    return parseCssColor(getComputedStyle(root).getPropertyValue(name))
  } catch (error) {
    throw new Error(`${name}: ${(error as Error).message}`)
  }
}

/** The canvas's colours, by role. */
const PALETTE_TOKENS = {
  outline: '--mp-outline',
  shadow: '--mp-shadow',
  hallway: '--mp-ph-hallway',
  floorBare: '--mp-ph-floor-bare',
  floorPainted: '--mp-ph-floor-painted',
  floorFinished: '--mp-ph-floor-finished',
  wallBare: '--mp-ph-wall-bare',
  wallPainted: '--mp-ph-wall-painted',
  wallFinished: '--mp-ph-wall-finished',
  wood: '--mp-ph-wood',
  rug: '--mp-ph-rug',
  glass: '--mp-ph-glass',
  parchment: '--mp-parchment',
  gold: '--mp-gold',
  success: '--mp-success',
  dark: '--mp-dark',
  dust: '--mp-dust',
  cobweb: '--mp-cobweb',
  walkTint: '--mp-walk-tint',
  walkEdge: '--mp-walk-edge',
  lantern: '--mp-walk-lantern'
} as const

export type Palette = Record<keyof typeof PALETTE_TOKENS, number>

export function readPalette(root: Element = document.documentElement): Palette {
  return Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([role, token]) => [role, readToken(token, root)])) as Palette
}

/** The CSS variable holding a room's accent. */
export const roomAccentToken = (roomId: string): string => `--mp-room-${roomId}`
