import { useEffect, useMemo, useRef, useState } from 'react'
// The app's content-security policy forbids eval; this entry makes PixiJS build its shaders without it.
import 'pixi.js/unsafe-eval'
import { Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { AGENT_LABEL, type RoomAgent } from '@shared/agents'
import type { ShellTier } from '@shared/catalog'
import { iso, LOBBY as LOBBY_AT, PAINTED_WALL, roomAt, ROOM_TILES, tileAt, WALL_FULL, type FloorBlock, type FloorRoom, type FloorView, type FloorWall } from '@shared/floor'
import { HELPER_FIGURE_HEIGHT, HELPER_SPRITE, LOBBY_SPRITE, NATO_FRAMES, ROOM_CUT } from './roomArt'

/**
 * The connected palace, drawn as one PixiJS scene from the floor model. A room
 * that has a painting is shown as that painting, cut out and set on the floor;
 * a room without one is drawn as placeholder blocks sized by footprint and height.
 * This component only draws and reports clicks; everything it shows comes in
 * through props.
 */

const hex = (colour: string): number => parseInt(colour.replace('#', ''), 16)
const shade = (colour: number, factor: number): number => {
  const channel = (shift: number): number => Math.max(0, Math.min(255, Math.round(((colour >> shift) & 0xff) * factor)))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}
const mix = (a: number, b: number, t: number): number => {
  const channel = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** The room's shell tier shows in its floor and walls: bare is dull, finished is warm. */
const SHELL: Record<ShellTier, { floor: number; wall: number; tint: number }> = {
  bare: { floor: 0x4d4037, wall: 0x5a4c42, tint: 0.05 },
  painted: { floor: 0x6f4e35, wall: 0x7a5a40, tint: 0.12 },
  finished: { floor: 0x8a5a33, wall: 0x94683f, tint: 0.2 }
}
const HALL_FLOOR = 0x35261d
const OUTLINE = 0x150e0f
const WOOD = 0xa9744a
const PARCHMENT = 0xf3e6c8
const GOLD = 0xe8b84a
const SUCCESS = 0x9cc27a

const pts = (corners: Array<{ x: number; y: number }>): number[] => corners.flatMap((c) => [c.x, c.y])

/** A box on the floor: top face, then the two faces towards the viewer. */
function drawBox(g: Graphics, x: number, y: number, w: number, d: number, z: number, h: number, colour: number, stroke = OUTLINE, strokeWidth = 1): void {
  const top = z + h
  g.poly(pts([iso(x, y + d, top), iso(x + w, y + d, top), iso(x + w, y + d, z), iso(x, y + d, z)])).fill(shade(colour, 0.78)).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
  g.poly(pts([iso(x + w, y, top), iso(x + w, y + d, top), iso(x + w, y + d, z), iso(x + w, y, z)])).fill(shade(colour, 0.6)).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
  g.poly(pts([iso(x, y, top), iso(x + w, y, top), iso(x + w, y + d, top), iso(x, y + d, top)])).fill(colour).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
}

function drawFloor(g: Graphics, x: number, y: number, w: number, d: number, colour: number): void {
  g.poly(pts([iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)])).fill(colour)
  // Tile seams, faint.
  for (let i = 0; i <= w; i++) g.moveTo(iso(x + i, y).x, iso(x + i, y).y).lineTo(iso(x + i, y + d).x, iso(x + i, y + d).y)
  for (let j = 0; j <= d; j++) g.moveTo(iso(x, y + j).x, iso(x, y + j).y).lineTo(iso(x + w, y + j).x, iso(x + w, y + j).y)
  g.stroke({ color: OUTLINE, width: 1, alpha: 0.22 })
}

const WALL_T = 0.14

function drawWall(g: Graphics, wall: FloorWall, colour: number): void {
  const runs: Array<[number, number]> = wall.doorway
    ? [
        [0, wall.doorway[0]],
        [wall.doorway[1], wall.length]
      ]
    : [[0, wall.length]]
  for (const [from, to] of runs) {
    // Back walls sit just outside the room, front walls just inside the hallway.
    if (wall.along === 'x') drawBox(g, wall.x + from, wall.front ? wall.y : wall.y - WALL_T, to - from, WALL_T, 0, wall.height, colour)
    else drawBox(g, wall.front ? wall.x : wall.x - WALL_T, wall.y + from, WALL_T, to - from, 0, wall.height, colour)
  }
}

function blockColour(block: FloorBlock, accent: number): number {
  if (block.item === 'trophy') return GOLD
  if (block.layer === 'rug') return mix(0x5a3a2a, accent, 0.45)
  if (block.layer === 'wall_item') return block.item === 'window' ? 0x9cc9d6 : PARCHMENT
  // Signature items carry the room's colour; shared furniture is plain wood.
  return block.item.startsWith('base_') || block.item === 'trophy_shelf' ? WOOD : mix(WOOD, accent, 0.55)
}

/** How much of a painted room's colour shows at each shell tier: a bare room is dim and almost grey. */
function shellFilter(shell: ShellTier): ColorMatrixFilter | null {
  if (shell === 'finished') return null
  const filter = new ColorMatrixFilter()
  filter.saturate(shell === 'bare' ? -0.85 : -0.4, false)
  filter.brightness(shell === 'bare' ? 0.6 : 0.85, true)
  return filter
}

function drawRoom(layer: Container, room: FloorRoom, hovered: boolean, focused: boolean, painting: Texture | undefined): Container {
  const [ox, oy] = room.origin
  const look = SHELL[room.shell]
  const accent = hex(room.accent)
  const cut = ROOM_CUT[room.id]
  if (painting && cut) {
    const origin = iso(ox, oy)
    const picture = new Sprite(painting)
    picture.scale.set(1 / cut.scale)
    picture.position.set(origin.x - cut.anchorX / cut.scale, origin.y - cut.anchorY / cut.scale)
    const filter = shellFilter(room.shell)
    if (filter) picture.filters = [filter]
    layer.addChild(picture)
    if (hovered) {
      const outline = new Graphics()
      outline
        .poly(pts([iso(ox, oy), iso(ox + ROOM_TILES, oy), iso(ox + ROOM_TILES, oy + ROOM_TILES), iso(ox, oy + ROOM_TILES)]))
        .stroke({ color: accent, width: 3, alpha: 0.95 })
      layer.addChild(outline)
    }
    const cast = new Container()
    layer.addChild(cast)
    return cast
  }
  const back = new Graphics()
  drawFloor(back, ox, oy, ROOM_TILES, ROOM_TILES, mix(look.floor, accent, look.tint))
  for (const wall of room.walls) if (!wall.front) drawWall(back, wall, wall.height === WALL_FULL ? mix(look.wall, accent, look.tint * 0.7) : look.wall)
  // The room's light: one soft glow in its accent.
  const glow = iso(ox + 4, oy + 3)
  for (const [radius, alpha] of [
    [150, 0.05],
    [100, 0.06],
    [55, 0.07]
  ] as const) {
    back.ellipse(glow.x, glow.y, radius, radius / 2).fill({ color: accent, alpha: alpha * (room.shell === 'bare' ? 0.5 : 1) })
  }
  if (hovered || focused) {
    back.poly(pts([iso(ox, oy), iso(ox + ROOM_TILES, oy), iso(ox + ROOM_TILES, oy + ROOM_TILES), iso(ox, oy + ROOM_TILES)])).stroke({ color: accent, width: focused ? 2 : 3, alpha: focused ? 0.55 : 0.95 })
  }
  layer.addChild(back)

  const things = new Graphics()
  for (const block of room.blocks) {
    drawBox(things, block.x, block.y, block.w, block.d, block.z, block.h, blockColour(block, accent), block.isNew ? GOLD : OUTLINE, block.isNew ? 2.5 : 1)
  }
  layer.addChild(things)

  // Characters stand between the furniture and the front walls.
  const cast = new Container()
  layer.addChild(cast)

  const front = new Graphics()
  for (const wall of room.walls) if (wall.front) drawWall(front, wall, look.wall)
  layer.addChild(front)
  return cast
}

/** A texture from a bundled image, through a plain <img> so no worker or fetch is involved. */
async function loadTexture(url: string): Promise<Texture> {
  const image = new Image()
  image.src = url
  await image.decode()
  return Texture.from(image)
}

/** Where Nato stands in a room, and the way out of it towards the lobby, in room tiles. */
const STAND: readonly [number, number] = [4.5, 5.6]
const LOBBY: readonly [number, number] = [LOBBY_AT, LOBBY_AT]
function wayOut(origin: readonly [number, number]): Array<[number, number]> {
  const [ox, oy] = origin
  // Leave by the side that faces a hallway, then follow the hallway to the lobby.
  if (ox === 0) return [[ox + 7.6, oy + 4], [LOBBY_AT, oy + 4]]
  return [[ox + 4, oy === 0 ? oy + 7.6 : oy + 0.4], [ox + 4, LOBBY_AT]]
}
function standIn(roomId: string | undefined): readonly [number, number] {
  return (roomId && ROOM_CUT[roomId]?.nato) || STAND
}
function route(from: readonly [number, number] | null, to: readonly [number, number], stand: readonly [number, number]): Array<[number, number]> {
  const end: [number, number] = [to[0] + stand[0], to[1] + stand[1]]
  if (!from || (from[0] === to[0] && from[1] === to[1])) return [end]
  return [...wayOut(from), [LOBBY[0], LOBBY[1]], ...wayOut(to).reverse(), end]
}

/** Where the lobby's centrepiece stands (towards the back, clear of the front room's walls) and how wide it is drawn. */
const LOBBY_SPOT = 8.8
const LOBBY_WIDTH = 104
const WALK_SPEED = 7 // tiles per second
const STROLL_SPEED = 1.6
const CHARACTER_HEIGHT = 74 // logical pixels

type HelperSprite = Sprite & { agentState: string; baseX: number; baseY: number }

interface Camera {
  scale: number
  x: number
  y: number
}

/** How the floor is placed on the stage: screen = floor * scale + (x, y), in CSS pixels. */
export type CanvasCamera = Camera

/** The data type a dragged chat carries, so a room can take it. */
export const CHAT_DRAG_TYPE = 'application/x-mind-palace-chat'

export function PalaceCanvas({
  floor,
  focus,
  natoRoom,
  agents,
  onPick,
  onCamera,
  onDropChat
}: {
  floor: FloorView
  /** The room zoomed into, or null for the whole palace. */
  focus: string | null
  /** The room Nato is in (he walks there when it changes), or null for the lobby. */
  natoRoom: string | null
  agents: Readonly<Record<string, RoomAgent>>
  onPick: (roomId: string) => void
  /** Called whenever the camera moves, so things can be pinned over the floor in HTML. */
  onCamera: (camera: CanvasCamera) => void
  /** A chat dragged from the list was dropped on a room. */
  onDropChat: (roomId: string, chatId: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const stage = useRef<{
    app: Application
    world: Container
    rooms: Container
    nato: Sprite | null
    textures: { walk: Texture[]; sit: Texture; helpers: Record<string, Texture>; lobby: Texture; rooms: Record<string, Texture> } | null
  } | null>(null)
  const camera = useRef<{ now: Camera; goal: Camera; free: boolean }>({ now: { scale: 1, x: 0, y: 0 }, goal: { scale: 1, x: 0, y: 0 }, free: false })
  const walk = useRef<{
    at: [number, number]
    path: Array<[number, number]>
    room: readonly [number, number] | null
    /** Where he stands in his room, and when he next takes a few steps on his own. */
    home: [number, number] | null
    roomId: string | null
    nextStroll: number
    strolling: boolean
  }>({ at: [LOBBY[0], LOBBY[1]], path: [], room: null, home: null, roomId: null, nextStroll: 0, strolling: false })
  const helpers = useRef<HelperSprite[]>([])
  const latest = useRef({ floor, focus, onPick, onCamera, onDropChat, agents })
  latest.current = { floor, focus, onPick, onCamera, onDropChat, agents }
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  /** The camera that shows a room, or the whole floor, inside the stage. */
  const cameraFor = (roomId: string | null): Camera => {
    const el = host.current
    const width = el?.clientWidth ?? 800
    const height = el?.clientHeight ?? 500
    const room = roomId ? latest.current.floor.rooms.find((r) => r.id === roomId) : undefined
    let box = latest.current.floor.bounds
    if (room) {
      const [ox, oy] = room.origin
      const tall = ROOM_CUT[room.id] ? PAINTED_WALL : room.walls.some((w) => w.height === WALL_FULL) ? WALL_FULL : 1.6
      const corners = [iso(ox, oy, tall), iso(ox + ROOM_TILES, oy, tall), iso(ox, oy + ROOM_TILES), iso(ox + ROOM_TILES, oy + ROOM_TILES)]
      box = {
        minX: Math.min(...corners.map((c) => c.x)),
        maxX: Math.max(...corners.map((c) => c.x)),
        minY: Math.min(...corners.map((c) => c.y)),
        maxY: Math.max(...corners.map((c) => c.y))
      }
    }
    const margin = room ? 0.86 : 0.94
    const scale = Math.min((width * margin) / (box.maxX - box.minX), (height * margin) / (box.maxY - box.minY))
    return { scale, x: width / 2 - ((box.minX + box.maxX) / 2) * scale, y: height / 2 - ((box.minY + box.maxY) / 2) * scale }
  }

  // Set the scene up once.
  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    const app = new Application()
    void (async () => {
      await app.init({ resizeTo: el, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
      if (cancelled) {
        app.destroy(true, { children: true })
        return
      }
      el.appendChild(app.canvas)
      const world = new Container()
      const halls = new Graphics()
      const rooms = new Container()
      const top = new Container()
      world.addChild(halls, rooms, top)
      app.stage.addChild(world)
      stage.current = { app, world, rooms, nato: null, textures: null }

      camera.current.now = cameraFor(latest.current.focus)
      camera.current.goal = camera.current.now

      const paintings = await Promise.all(Object.entries(ROOM_CUT).map(async ([id, cut]) => [id, await loadTexture(cut.url)] as const))
      const helperTextures = await Promise.all(Object.entries(HELPER_SPRITE).map(async ([id, url]) => [id, await loadTexture(url)] as const))
      const textures = {
        walk: await Promise.all(NATO_FRAMES.walk.map(loadTexture)),
        sit: await loadTexture(NATO_FRAMES.sit),
        helpers: Object.fromEntries(helperTextures),
        lobby: await loadTexture(LOBBY_SPRITE.url),
        rooms: Object.fromEntries(paintings)
      }
      const standing = textures.walk[3]!
      if (cancelled) return
      const shadow = new Graphics()
      shadow.ellipse(0, 0, 15, 6).fill({ color: 0x000000, alpha: 0.35 })
      const nato = new Sprite(standing)
      nato.anchor.set(0.5, 0.985)
      const natoScale = CHARACTER_HEIGHT / NATO_FRAMES.figureHeight
      nato.scale.set(natoScale)
      top.addChild(shadow, nato)
      stage.current.nato = nato
      stage.current.textures = textures

      let last = ''
      let clock = 0
      app.ticker.add((ticker) => {
        const seconds = ticker.deltaMS / 1000
        clock += seconds
        // Camera eases towards its goal.
        const cam = camera.current
        const ease = reducedMotion ? 1 : Math.min(1, seconds * 7)
        cam.now = {
          scale: cam.now.scale + (cam.goal.scale - cam.now.scale) * ease,
          x: cam.now.x + (cam.goal.x - cam.now.x) * ease,
          y: cam.now.y + (cam.goal.y - cam.now.y) * ease
        }
        world.scale.set(cam.now.scale)
        world.position.set(cam.now.x, cam.now.y)

        // Nato walks along his route; left alone in a room, he takes a few steps now and then.
        const w = walk.current
        if (w.path.length === 0 && w.home && !reducedMotion && clock > w.nextStroll) {
          const angle = Math.random() * Math.PI * 2
          const reach = 0.5 + Math.random() * 0.8
          w.path = [[w.home[0] + Math.cos(angle) * reach, w.home[1] + Math.sin(angle) * reach * 0.8]]
          w.strolling = true
          w.nextStroll = clock + 4 + Math.random() * 6
        }
        let budget = reducedMotion ? Infinity : (w.strolling ? STROLL_SPEED : WALK_SPEED) * seconds
        let facing = 0
        while (w.path.length > 0 && budget > 0) {
          const [tx, ty] = w.path[0]!
          const dx = tx - w.at[0]
          const dy = ty - w.at[1]
          const distance = Math.hypot(dx, dy)
          if (distance <= budget) {
            w.at = [tx, ty]
            w.path.shift()
            budget -= distance
          } else {
            w.at = [w.at[0] + (dx / distance) * budget, w.at[1] + (dy / distance) * budget]
            facing = dx - dy
            budget = 0
          }
        }
        const walking = w.path.length > 0
        if (!walking && w.strolling) {
          w.strolling = false
          w.nextStroll = clock + 3 + Math.random() * 6
        }
        // On screen, x - y is left to right: he turns to face the way he is going.
        if (Math.abs(facing) > 0.01) nato.scale.x = natoScale * (facing < 0 ? -1 : 1)
        const spot = iso(w.at[0], w.at[1])
        // Walking plays the four frames of a stride; a stroll is the same stride, slower.
        const stride = w.strolling ? 5 : 10
        const frame = Math.floor(clock * stride) % 4
        const lifted = walking && !reducedMotion && frame % 2 === 1 ? 1.5 : 0
        const breath = reducedMotion ? 0 : Math.sin(clock * 2.2)
        // He sits down while the helper of his room is busy with an answer.
        const busyHere = !walking && w.roomId !== null && (latest.current.agents[w.roomId]?.state ?? 'idle') !== 'idle' && latest.current.agents[w.roomId]?.state !== 'done'
        nato.texture = walking ? (reducedMotion ? standing : textures.walk[frame]!) : busyHere ? textures.sit : standing
        nato.position.set(spot.x, spot.y - lifted)
        nato.scale.y = natoScale * (walking ? 1 : 1 + breath * 0.012)
        shadow.position.set(spot.x, spot.y)
        shadow.scale.set(walking && lifted ? 0.85 : 1)

        // Helpers move according to what they are doing.
        if (!reducedMotion) {
          for (const sprite of helpers.current) {
            if (sprite.agentState === 'idle') sprite.y = sprite.baseY - Math.abs(Math.sin(clock * 1.4)) * 1.2
            else if (sprite.agentState === 'thinking') sprite.rotation = Math.sin(clock * 5) * 0.09
            else if (sprite.agentState === 'searching') sprite.x = sprite.baseX + Math.sin(clock * 7) * 5
            else if (sprite.agentState === 'writing') sprite.y = sprite.baseY - Math.abs(Math.sin(clock * 13)) * 4
          }
        }

        // Tell React where the labels go, only when the camera has moved.
        const key = `${cam.now.scale.toFixed(3)}|${cam.now.x.toFixed(1)}|${cam.now.y.toFixed(1)}`
        if (key !== last) {
          last = key
          latest.current.onCamera({ ...cam.now })
        }
      })
      setReady(true)
    })()
    return () => {
      cancelled = true
      if (stage.current?.app === app) {
        stage.current = null
        app.destroy(true, { children: true })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw the floor when the data, the hovered room or the helpers change.
  useEffect(() => {
    const s = stage.current
    if (!ready || !s || !s.textures) return
    const halls = s.world.children[0] as Graphics
    halls.clear()
    for (const hall of floor.halls) drawFloor(halls, hall.x, hall.y, hall.w, hall.d, HALL_FLOOR)
    for (const old of s.rooms.removeChildren()) old.destroy({ children: true })
    helpers.current = []
    const frontMost = floor.rooms[floor.rooms.length - 1]
    for (const room of floor.rooms) {
      if (room === frontMost) {
        // The lobby's centrepiece stands in front of the back rooms and behind the front one.
        const piece = new Sprite(s.textures.lobby)
        const at = iso(LOBBY_SPOT, LOBBY_SPOT)
        piece.anchor.set(0.42, 0.9)
        piece.scale.set(LOBBY_WIDTH / LOBBY_SPRITE.width)
        piece.position.set(at.x, at.y)
        piece.alpha = focus !== null ? 0.16 : 1
        s.rooms.addChild(piece)
      }
      const layer = new Container()
      // Zoomed into a room, the others step back so their walls do not crowd the view.
      layer.alpha = focus !== null && focus !== room.id ? 0.16 : 1
      s.rooms.addChild(layer)
      const cast = drawRoom(layer, room, hover === room.id && focus !== room.id, focus === room.id, s.textures.rooms[room.id])
      const agent = agents[room.id]
      const painted = ROOM_CUT[room.id]
      const spotTile = painted ? [room.origin[0] + painted.helper[0], room.origin[1] + painted.helper[1]] : [room.helperSpots[0]![0] + 0.5, room.helperSpots[0]![1] + 0.5]
      const spot = iso(spotTile[0]!, spotTile[1]!)
      const helper = new Sprite(s.textures.helpers[room.id] ?? s.textures.helpers['coding']!) as HelperSprite
      helper.anchor.set(0.5, 0.98)
      helper.scale.set((CHARACTER_HEIGHT * 0.72) / HELPER_FIGURE_HEIGHT)
      helper.position.set(spot.x, spot.y)
      helper.agentState = agent?.state ?? 'idle'
      helper.baseX = spot.x
      helper.baseY = spot.y
      cast.addChild(helper)
      helpers.current.push(helper)
      if (agent && agent.state !== 'idle') {
        // A dot over an active helper: the room's colour while working, green when done.
        const dot = new Graphics()
        const colour = agent.state === 'done' ? SUCCESS : hex(room.accent)
        dot.circle(spot.x, spot.y - CHARACTER_HEIGHT * 0.72 - 9, 9).fill({ color: colour, alpha: 0.28 })
        dot.circle(spot.x, spot.y - CHARACTER_HEIGHT * 0.72 - 9, 5).fill(colour).stroke({ color: OUTLINE, width: 1 })
        cast.addChild(dot)
      }
    }
  }, [ready, floor, hover, focus, agents])

  // Zoom to the focused room, or back out to the whole palace.
  useEffect(() => {
    if (!ready) return
    camera.current.goal = cameraFor(focus)
    camera.current.free = false
  }, [ready, focus, floor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the framing when the stage is resized, unless the person has moved the camera.
  useEffect(() => {
    const el = host.current
    if (!el || !ready) return
    const observer = new ResizeObserver(() => {
      // PixiJS only follows window resizes; the stage also changes size when a panel opens beside it.
      stage.current?.app.resize()
      if (camera.current.free) return
      camera.current.goal = cameraFor(latest.current.focus)
      camera.current.now = camera.current.goal
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nato walks to the room he is wanted in.
  useEffect(() => {
    if (!ready) return
    const target = natoRoom ? floor.rooms.find((r) => r.id === natoRoom)?.origin : undefined
    const w = walk.current
    if (!target) {
      if (w.room) w.path = [...wayOut(w.room), [LOBBY[0], LOBBY[1]]]
      w.room = null
      w.home = null
      w.roomId = null
      w.strolling = false
      return
    }
    if (w.room && w.room[0] === target[0] && w.room[1] === target[1]) return
    const stand = standIn(natoRoom ?? undefined)
    w.path = route(w.room, target, stand)
    if (!w.room) w.path = [...wayOut(target).reverse(), ...w.path]
    w.room = target
    w.home = [target[0] + stand[0], target[1] + stand[1]]
    w.roomId = natoRoom
    w.strolling = false
  }, [ready, natoRoom, floor])

  // Pointer: hover outlines a room, a click enters it, drag pans, the wheel zooms.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const roomUnder = (event: PointerEvent | WheelEvent | DragEvent): string | null => {
      const box = el.getBoundingClientRect()
      const cam = camera.current.now
      const tile = tileAt({ x: (event.clientX - box.left - cam.x) / cam.scale, y: (event.clientY - box.top - cam.y) / cam.scale })
      return roomAt(tile.x, tile.y)
    }
    let drag: { x: number; y: number; moved: boolean } | null = null
    const down = (event: PointerEvent): void => {
      drag = { x: event.clientX, y: event.clientY, moved: false }
      el.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent): void => {
      if (drag) {
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        if (!drag.moved && Math.hypot(dx, dy) < 5) return
        drag.moved = true
        drag.x = event.clientX
        drag.y = event.clientY
        const cam = camera.current
        cam.free = true
        cam.goal = { ...cam.goal, x: cam.goal.x + dx, y: cam.goal.y + dy }
        cam.now = { ...cam.goal }
        return
      }
      setHover(roomUnder(event))
    }
    const up = (event: PointerEvent): void => {
      const wasDrag = drag?.moved ?? false
      drag = null
      if (wasDrag) return
      const room = roomUnder(event)
      if (room && room !== latest.current.focus) latest.current.onPick(room)
    }
    const leave = (): void => setHover(null)
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = el.getBoundingClientRect()
      const cam = camera.current
      const fit = cameraFor(null).scale
      const scale = Math.max(fit * 0.7, Math.min(fit * 6, cam.goal.scale * Math.exp(-event.deltaY * 0.0015)))
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      // Keep the point under the cursor where it is.
      cam.goal = { scale, x: px - ((px - cam.goal.x) / cam.goal.scale) * scale, y: py - ((py - cam.goal.y) / cam.goal.scale) * scale }
      cam.free = true
    }
    // A chat dragged from the list can be dropped on a room to file it there.
    const dragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes(CHAT_DRAG_TYPE)) return
      const room = roomUnder(event)
      setHover(room)
      if (room) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }
    }
    const drop = (event: DragEvent): void => {
      const chatId = event.dataTransfer?.getData(CHAT_DRAG_TYPE)
      const room = roomUnder(event)
      setHover(null)
      if (!chatId || !room) return
      event.preventDefault()
      latest.current.onDropChat(room, chatId)
    }
    el.addEventListener('dragover', dragOver)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('dragover', dragOver)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = floor.rooms.filter((r) => agents[r.id] && agents[r.id]!.state !== 'idle')
  return (
    <div
      ref={host}
      className={`palace-canvas absolute inset-0 touch-none ${hover && focus === null ? 'cursor-pointer' : 'cursor-grab'}`}
      data-ready={ready}
      data-focus={focus ?? ''}
      role="img"
      aria-label={`The palace floor: ${floor.rooms.map((r) => r.name).join(', ')}${busy.length ? `. Helpers at work: ${busy.map((r) => `${r.name} (${AGENT_LABEL[agents[r.id]!.state]})`).join(', ')}` : ''}`}
    />
  )
}
