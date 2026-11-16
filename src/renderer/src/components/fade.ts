/**
 * Helpers for the "lights back on" fade, kept free of PixiJS so they can be
 * tested. A room's layer is rebuilt on every redraw, so the fade lives per
 * room (not per layer) and never writes to a layer that was destroyed:
 * Pixi's filters setter throws on one.
 */

export interface Filterable {
  destroyed: boolean
  filters: unknown
}

/** Sets a layer's filters unless the layer is gone. Returns whether it did. */
export function setFiltersIfAlive<T extends Filterable>(layer: T, filters: T['filters']): boolean {
  if (layer.destroyed) return false
  layer.filters = filters
  return true
}

export interface Fade {
  /** Darkness when the lights came back on. */
  from: number
  /** performance.now() when it started. */
  start: number
}

/** The darkness left `now` ms into a fade that lasts `ms`. */
export function fadeDarkness(fade: Fade, now: number, ms: number): number {
  const t = Math.min(1, Math.max(0, (now - fade.start) / ms))
  return t >= 1 ? 0 : fade.from * (1 - t)
}
