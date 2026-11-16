/** Colour parsing shared by the renderer's theme and its tests. */

/** A token's value (`#rrggbb`) as a Pixi colour number. */
export function parseCssColor(value: string): number {
  const text = value.trim()
  if (!text) throw new Error('missing token: a colour token has no value')
  const match = /^#([0-9a-fA-F]{6})$/.exec(text)
  if (!match) throw new Error(`not a #rrggbb colour: "${text}"`)
  return Number.parseInt(match[1]!, 16)
}
