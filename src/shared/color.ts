/** Colour parsing shared by the renderer's theme and its tests. */

/** A token's value (`#rrggbb`) as a Pixi colour number. */
export function parseCssColor(value: string): number {
  const text = value.trim()
  if (!text) throw new Error('missing token: a colour token has no value')
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(text)
  if (!match) throw new Error(`not a #rrggbb colour: "${text}"`)
  // CSS minifiers write #rgb for #rrggbb.
  const digits = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!
  return Number.parseInt(digits, 16)
}

/** A colour scaled by `factor` per channel (0 = black, 1 = unchanged). */
export function shade(colour: number, factor: number): number {
  const channel = (shift: number): number => Math.max(0, Math.min(255, Math.round(((colour >> shift) & 0xff) * factor)))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** A placeholder block's three visible faces (asset spec 4): top 100 %, left 82 %, right 62 %. */
export function faceShades(colour: number): [top: number, left: number, right: number] {
  return [colour, shade(colour, 0.82), shade(colour, 0.62)]
}
