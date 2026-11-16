import { describe, expect, it } from 'vitest'
import { darknessOf, flickerOn, nextFlickerDelay } from '../src/shared/flicker'

describe('nextFlickerDelay', () => {
  it('waits 20 to 60 seconds between flickers', () => {
    expect(nextFlickerDelay(() => 0)).toBe(20_000)
    expect(nextFlickerDelay(() => 0.5)).toBe(40_000)
    expect(nextFlickerDelay(() => 0.9999)).toBeLessThan(60_000)
    expect(nextFlickerDelay(() => 0.9999)).toBeGreaterThan(59_000)
  })
})

describe('flickerOn', () => {
  it('flickers only a mostly dark room, and never with reduced motion', () => {
    expect(flickerOn(3, false)).toBe(true)
    expect(flickerOn(3, true)).toBe(false)
    expect(flickerOn(4, false)).toBe(false)
    expect(flickerOn(2, false)).toBe(false)
    expect(flickerOn(0, false)).toBe(false)
  })
})

describe('darknessOf', () => {
  it('darkens from level 3, nearly black at 4', () => {
    expect([0, 1, 2, 3, 4].map((l) => darknessOf(l as 0 | 1 | 2 | 3 | 4))).toEqual([0, 0, 0, 0.75, 0.92])
  })
})
