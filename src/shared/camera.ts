/**
 * The palace camera, pure: which scale and offset show a box of the floor in
 * a viewport. The canvas eases towards what these return.
 */
import { iso, ROOM_TILES, WALL_FULL, type FloorRoom } from './floor'

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Camera {
  scale: number
  x: number
  y: number
}

/** Scale and offset that show `box` centred in the viewport with `padding` px to spare on the tighter side. */
export function fitCamera(box: Box, viewport: { width: number; height: number }, padding = 24): Camera {
  const width = Math.max(1, viewport.width - padding * 2)
  const height = Math.max(1, viewport.height - padding * 2)
  const scale = Math.min(width / (box.maxX - box.minX), height / (box.maxY - box.minY))
  return {
    scale,
    x: viewport.width / 2 - ((box.minX + box.maxX) / 2) * scale,
    y: viewport.height / 2 - ((box.minY + box.maxY) / 2) * scale
  }
}

/** A room's screen box: its floor and its tallest back wall. */
export function boxOfRoom(room: Pick<FloorRoom, 'origin' | 'walls'>): Box {
  const [ox, oy] = room.origin
  const tall = room.walls.some((w) => w.height === WALL_FULL) ? WALL_FULL : 1
  const corners = [iso(ox, oy, tall), iso(ox + ROOM_TILES, oy, tall), iso(ox, oy + ROOM_TILES, tall), iso(ox + ROOM_TILES, oy + ROOM_TILES)]
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxY: Math.max(...corners.map((c) => c.y))
  }
}
