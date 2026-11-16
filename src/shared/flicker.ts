/**
 * Timing and strength of a decayed room's darkness (plan v2, Decay). Pure; the
 * canvas schedules and draws.
 */
import type { DecayLevel } from './engine'

/** Milliseconds until a mostly dark room's light flickers on again: 20 to 60 seconds at random. */
export function nextFlickerDelay(random: () => number): number {
  return Math.floor(20_000 + random() * 40_000)
}

/** Only a mostly dark room (level 3) flickers, and never when the person asked for reduced motion. */
export function flickerOn(level: DecayLevel, reducedMotion: boolean): boolean {
  return level === 3 && !reducedMotion
}

/** How much of the room the darkness covers: from level 3, nearly black at 4. */
export function darknessOf(level: DecayLevel): number {
  return level >= 4 ? 0.92 : level === 3 ? 0.75 : 0
}

/** How long a flicker keeps the light on, and how dark the room is meanwhile. */
export const FLICKER = { ms: 300, alpha: 0.2 } as const
/** The "lights back on" moment when a room's decay drops. */
export const LIGHTS_ON_MS = 600
