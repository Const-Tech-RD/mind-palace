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
  cobweb: '--mp-cobweb'
} as const

export type Palette = Record<keyof typeof PALETTE_TOKENS, number>

export function readPalette(root: Element = document.documentElement): Palette {
  return Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([role, token]) => [role, readToken(token, root)])) as Palette
}

/** The CSS variable for a room's accent token name (`mp-room-accent-3` → `--mp-room-accent-3`). */
export const accentVar = (accent: string): string => `--${accent}`

/** A room's accent as a CSS value, for `style` props. */
export const accentCss = (accent: string): string => `var(${accentVar(accent)})`
