import { describe, expect, it } from 'vitest'
import { boxOfRoom, fitCamera } from '../src/shared/camera'
import { faceShades } from '../src/shared/color'
import { buildPalace } from '../src/shared/palace'
import { iso } from '../src/shared/floor'
import { catalog } from './helpers'

const floor = buildPalace({
  catalog,
  rows: { chats: [], messages: [], goalCompletions: [] },
  timeZone: 'UTC',
  today: '2026-11-12',
  seen: {}
}).floor

describe('fitCamera', () => {
  it('fits the whole palace inside the viewport with 24 px to spare on the tighter side', () => {
    const cam = fitCamera(floor.bounds, { width: 800, height: 600 })
    const left = floor.bounds.minX * cam.scale + cam.x
    const right = floor.bounds.maxX * cam.scale + cam.x
    const top = floor.bounds.minY * cam.scale + cam.y
    const bottom = floor.bounds.maxY * cam.scale + cam.y
    expect(Math.min(left, top, 800 - right, 600 - bottom)).toBeCloseTo(24)
    expect(left).toBeGreaterThanOrEqual(23.99)
    expect(top).toBeGreaterThanOrEqual(23.99)
  })

  it('centres a focused room, and keeps it centred after a resize', () => {
    const mail = floor.rooms.find((r) => r.id === 'mailroom')!
    const centre = iso(mail.origin[0] + 4, mail.origin[1] + 4)
    for (const viewport of [{ width: 800, height: 600 }, { width: 420, height: 700 }]) {
      const cam = fitCamera(boxOfRoom(mail), viewport)
      // The floor's centre sits in the middle horizontally and inside the view vertically.
      expect(centre.x * cam.scale + cam.x).toBeCloseTo(viewport.width / 2)
      const y = centre.y * cam.scale + cam.y
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(viewport.height)
    }
  })

  it('makes a room box tall enough for its highest wall', () => {
    const coding = floor.rooms.find((r) => r.id === 'coding')!
    expect(boxOfRoom(coding).minY).toBe(iso(0, 0, 4).y)
  })
})

describe('faceShades', () => {
  it('lights the top fully, the left face at 82 % and the right at 62 %', () => {
    expect(faceShades(0xffffff)).toEqual([0xffffff, 0xd1d1d1, 0x9e9e9e])
    expect(faceShades(0x000000)).toEqual([0, 0, 0])
  })
})
