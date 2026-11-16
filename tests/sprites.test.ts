import { describe, expect, it } from 'vitest'
import { iso } from '../src/shared/floor'
import { spritePlacement, type SpriteEntry } from '../src/shared/sprites'

const entry = (footprint: [number, number], height = 1): SpriteEntry => {
  const [w, d] = footprint
  const canvas: [number, number] = [(w + d) * 64, Math.round(((w + d) * 16 + height * 32) * 2)]
  return { id: 'x', file: 'x.png', footprint, canvas, anchor: [w * 64, canvas[1]], scale: 2 }
}
const block = (x: number, y: number, w: number, d: number, z = 0, layer = 'floor_item') => ({ x, y, w, d, z, layer })

describe('spritePlacement', () => {
  it('stands a 1 x 1 chair on the front corner of its tile at half size', () => {
    const p = spritePlacement(block(3, 1, 1, 1), entry([1, 1], 1.5), null)
    expect([p.x, p.y]).toEqual([iso(4, 2).x, iso(4, 2).y])
    expect([p.anchorX, p.anchorY]).toEqual([0.5, 1])
    expect([p.scaleX, p.scaleY]).toEqual([0.5, 0.5])
  })

  it('anchors a 3 x 1 desk three quarters of the way across', () => {
    const p = spritePlacement(block(2, 0, 3, 1), entry([3, 1]), null)
    expect([p.x, p.y]).toEqual([iso(5, 1).x, iso(5, 1).y])
    expect(p.anchorX).toBe(0.75)
    expect(p.scaleX).toBe(0.5)
  })

  it('shrinks a desk-top item to its inset block and lifts it by the desk', () => {
    const p = spritePlacement(block(3.2, 0.2, 0.6, 0.6, 1, 'surface_item'), entry([1, 1], 0.5), null)
    expect(p.scaleX).toBeCloseTo(0.3)
    expect(p.scaleY).toBeCloseTo(0.3)
    expect(p.y).toBeCloseTo(iso(3.8, 0.8, 1).y)
  })

  it('hangs a wall item as drawn on the right wall and mirrored on the left', () => {
    const right = spritePlacement(block(4, 0, 2, 0.12, 2, 'wall_item'), entry([2, 0], 1.5), 'right')
    const left = spritePlacement(block(0, 4, 0.12, 2, 2, 'wall_item'), entry([2, 0], 1.5), 'left')
    expect(right.scaleX).toBeCloseTo(0.5)
    expect(left.scaleX).toBeCloseTo(-0.5)
    expect(left.scaleY).toBeCloseTo(0.5)
    expect([left.x, left.y]).toEqual([iso(0.12, 6, 2).x, iso(0.12, 6, 2).y])
  })

  it('mirrors a floor item whose slot turns it round', () => {
    const turned = spritePlacement(block(0, 4, 1, 2), entry([2, 1]), null)
    const straight = spritePlacement(block(0, 4, 2, 1), entry([2, 1]), null)
    expect(turned.scaleX).toBeLessThan(0)
    expect(straight.scaleX).toBeGreaterThan(0)
  })
})
