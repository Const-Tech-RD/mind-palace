import { describe, expect, it } from 'vitest'
import { fadeDarkness, setFiltersIfAlive } from '../src/renderer/src/components/fade'

describe('setFiltersIfAlive', () => {
  it('writes filters to a live layer and leaves a destroyed one alone', () => {
    const live = { destroyed: false, filters: [] as unknown[] }
    expect(setFiltersIfAlive(live, ['f'])).toBe(true)
    expect(live.filters).toEqual(['f'])
    const gone = {
      destroyed: true,
      get filters(): unknown[] {
        return []
      },
      set filters(_value: unknown[]) {
        throw new TypeError("Cannot read properties of null (reading 'indexOf')")
      }
    }
    expect(setFiltersIfAlive(gone, ['f'])).toBe(false)
  })
})

describe('fadeDarkness', () => {
  it('lifts the darkness from its start to zero over the fade, wherever the frame lands', () => {
    const fade = { from: 0.75, start: 1000 }
    expect(fadeDarkness(fade, 1000, 600)).toBe(0.75)
    expect(fadeDarkness(fade, 1300, 600)).toBeCloseTo(0.375)
    expect(fadeDarkness(fade, 1600, 600)).toBe(0)
    expect(fadeDarkness(fade, 5000, 600)).toBe(0)
  })
})
