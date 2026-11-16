import { useEffect, useMemo, useRef, useState } from 'react'
// The app's content-security policy forbids eval; this entry makes PixiJS build its shaders without it.
import 'pixi.js/unsafe-eval'
import { Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { AGENT_LABEL, type RoomAgent } from '@shared/agents'
import type { ShellTier } from '@shared/catalog'
import { iso, LOBBY as LOBBY_AT, wayOut as wayOutOf, roomAt, ROOM_TILES, tileAt, WALL_FULL, type FloorBlock, type FloorRoom, type FloorView, type FloorWall, type Rect } from '@shared/floor'
import { HELPER_FIGURE_HEIGHT, HELPER_SPRITE, LOBBY_SPRITE, NATO_FRAMES, ROOM_CUT } from './roomArt'
import { boxOfRoom, fitCamera } from '@shared/camera'
import { faceShades, shade } from '@shared/color'
import { slotAt } from '@shared/editMode'
import { fadeDarkness, setFiltersIfAlive, type Fade } from './fade'
import { darknessOf, FLICKER, flickerOn, LIGHTS_ON_MS, nextFlickerDelay } from '@shared/flicker'
import type { DecayLevel } from '@shared/engine'
import { readPalette, readToken, roomAccentToken, type Palette } from '../theme'

/**
 * The connected palace, drawn as one PixiJS scene from the floor model. A room
 * has two looks. Day to day it is its painting, cut out and set on the floor.
 * While it is being arranged (`arranging`), it is drawn from its pieces: every
 * item a placeholder block sized by its footprint and height until its sprite
 * exists, so furniture can be moved. A room with no painting is always blocks.
 * This component only draws and reports clicks; everything it shows comes in
 * through props.
 */

const hex = (colour: string): number => parseInt(colour.replace('#', ''), 16)
const mix = (a: number, b: number, t: number): number => {
  const channel = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** The room's shell tier shows in its floor and walls: bare is dull, finished is warm. */
const SHELL_TINT: Record<ShellTier, number> = { bare: 0.05, painted: 0.12, finished: 0.2 }
const shellLook = (shell: ShellTier): { floor: number; wall: number; tint: number } => ({
  floor: shell === 'bare' ? P.floorBare : shell === 'painted' ? P.floorPainted : P.floorFinished,
  wall: shell === 'bare' ? P.wallBare : shell === 'painted' ? P.wallPainted : P.wallFinished,
  tint: SHELL_TINT[shell]
})
/** Every colour comes from the `--mp-*` tokens, read when the canvas mounts. */
let P: Palette
/** A room's accent token, or the catalog's accent when the theme has none for that room. */
function accentOf(room: { id: string; accent: string }): number {
  try {
    return readToken(roomAccentToken(room.id))
  } catch {
    return hex(room.accent)
  }
}

const pts = (corners: Array<{ x: number; y: number }>): number[] => corners.flatMap((c) => [c.x, c.y])

/** A box on the floor: top face, then the two faces towards the viewer. */
function drawBox(g: Graphics, x: number, y: number, w: number, d: number, z: number, h: number, colour: number, stroke?: number, strokeWidth = 1): void {
  const top = z + h
  stroke ??= P.outline
  const [topFace, leftFace, rightFace] = faceShades(colour)
  g.poly(pts([iso(x, y + d, top), iso(x + w, y + d, top), iso(x + w, y + d, z), iso(x, y + d, z)])).fill(leftFace).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
  g.poly(pts([iso(x + w, y, top), iso(x + w, y + d, top), iso(x + w, y + d, z), iso(x + w, y, z)])).fill(rightFace).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
  g.poly(pts([iso(x, y, top), iso(x + w, y, top), iso(x + w, y + d, top), iso(x, y + d, top)])).fill(topFace).stroke({ color: stroke, width: strokeWidth, alpha: 0.9 })
}

function drawFloor(g: Graphics, x: number, y: number, w: number, d: number, colour: number): void {
  g.poly(pts([iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)])).fill(colour)
  // Tile seams, faint.
  for (let i = 0; i <= w; i++) g.moveTo(iso(x + i, y).x, iso(x + i, y).y).lineTo(iso(x + i, y + d).x, iso(x + i, y + d).y)
  for (let j = 0; j <= d; j++) g.moveTo(iso(x, y + j).x, iso(x, y + j).y).lineTo(iso(x + w, y + j).x, iso(x + w, y + j).y)
  g.stroke({ color: P.outline, width: 1, alpha: 0.22 })
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
  if (block.item === 'trophy') return P.gold
  if (block.layer === 'rug') return mix(P.rug, accent, 0.45)
  if (block.layer === 'wall_item') return block.item === 'window' ? P.glass : P.parchment
  // Signature items carry the room's colour; shared furniture is plain wood.
  return block.item.startsWith('base_') || block.item === 'trophy_shelf' ? P.wood : mix(P.wood, accent, 0.55)
}

/** How much of a painted room's colour shows at each shell tier: a bare room is dim and almost grey. */
function shellFilter(shell: ShellTier): ColorMatrixFilter | null {
  if (shell === 'finished') return null
  const filter = new ColorMatrixFilter()
  // Filters draw at resolution 1 by default, which pixelates the painting on a dense display.
  filter.resolution = 'inherit'
  filter.saturate(shell === 'bare' ? -0.85 : -0.4, false)
  filter.brightness(shell === 'bare' ? 0.6 : 0.85, true)
  return filter
}

function drawRoom(layer: Container, room: FloorRoom, hovered: boolean, focused: boolean, painting?: Texture): Container {
  const [ox, oy] = room.origin
  const look = shellLook(room.shell)
  const accent = accentOf(room)
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
      // The painted floor's own corners, which are not exactly the grid's.
      outline.poly(cut.floor.flatMap(([x, y]) => [origin.x + x, origin.y + y])).stroke({ color: accent, width: 3, alpha: 0.95 })
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
  const glow = iso(room.lightAt[0], room.lightAt[1])
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
    drawBox(things, block.x, block.y, block.w, block.d, block.z, block.h, blockColour(block, accent), block.isNew ? P.gold : P.outline, block.isNew ? 2.5 : 1)
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

const diamond = (r: Rect, z = 0): number[] => pts([iso(r.x, r.y, z), iso(r.x + r.w, r.y, z), iso(r.x + r.w, r.y + r.d, z), iso(r.x, r.y + r.d, z)])
const inset = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: r.w - by * 2, d: r.d - by * 2 })

/**
 * Where the character walks: boarded hallways with a brass edge, a carpet down
 * the middle of each, a mat in each room's colour at its entrance, and a
 * lantern-lit plaza where they cross.
 */
function drawWalkways(g: Graphics, floor: FloorView, accents: Readonly<Record<string, number>>): void {
  for (const hall of floor.halls) {
    drawFloor(g, hall.x, hall.y, hall.w, hall.d, P.walkFloor)
    g.poly(diamond(hall)).stroke({ color: P.walkEdge, width: 1.5, alpha: 0.45 })
  }
  const { runners, mats, plaza, lanterns } = floor.walk
  const carpet = (r: Rect, colour: number): void => {
    g.poly(diamond(r)).fill(colour).stroke({ color: P.outline, width: 1, alpha: 0.7 })
    g.poly(diamond(inset(r, 0.18))).stroke({ color: P.gold, width: 1, alpha: 0.55 })
  }
  for (const mat of mats) carpet(mat, mix(P.carpet, accents[mat.roomId] ?? P.carpet, 0.45))
  for (const runner of runners) carpet(runner, P.carpet)
  // The plaza: a square of paler boards with a round rug of rings.
  g.poly(diamond(plaza)).fill(P.plaza).stroke({ color: P.walkEdge, width: 2, alpha: 0.8 })
  const centre = iso(plaza.x + plaza.w / 2, plaza.y + plaza.d / 2)
  for (const [radius, colour, alpha] of [
    [70, P.carpet, 1],
    [56, P.gold, 0.5],
    [50, P.carpet, 1],
    [26, P.gold, 0.35]
  ] as const) {
    g.ellipse(centre.x, centre.y, radius, radius / 2).fill({ color: colour, alpha })
  }
  for (const [x, y] of lanterns) {
    const foot = iso(x, y)
    const top = iso(x, y, 1.5)
    g.ellipse(foot.x, foot.y, 34, 17).fill({ color: P.lantern, alpha: 0.1 })
    g.ellipse(foot.x, foot.y, 16, 8).fill({ color: P.lantern, alpha: 0.14 })
    g.moveTo(foot.x, foot.y).lineTo(top.x, top.y).stroke({ color: P.walkEdge, width: 3 })
    g.circle(top.x, top.y, 9).fill({ color: P.lantern, alpha: 0.25 })
    g.circle(top.x, top.y, 4.5).fill(P.lantern).stroke({ color: P.outline, width: 1 })
  }
}

/** Small deterministic noise per room, so dust and cobwebs do not jump on every redraw. */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    return (h % 10000) / 10000
  }
}

/** Dust on the floor from level 1, cobwebs in the back corners from level 2 (plan v2, Decay). */
function drawDecay(layer: Container, room: FloorRoom, painted: boolean): void {
  if (room.decay < 1) return
  const [ox, oy] = room.origin
  const random = seeded(room.id)
  const g = new Graphics()
  for (let i = 0; i < 26 + room.decay * 10; i++) {
    const at = iso(ox + 0.3 + random() * (ROOM_TILES - 0.6), oy + 0.3 + random() * (ROOM_TILES - 0.6))
    g.ellipse(at.x, at.y, 2 + random() * 5, 1 + random() * 2.5).fill({ color: P.dust, alpha: 0.22 + random() * 0.18 })
  }
  if (room.decay >= 2) {
    const tall = painted ? -(ROOM_CUT[room.id]?.top ?? 0) / 32 - 0.6 : room.walls.some((w) => w.height === WALL_FULL) ? WALL_FULL : 1
    const corner = iso(ox, oy, tall)
    const down = iso(ox, oy, tall - 1.1)
    const right = iso(ox + 1.3, oy, tall)
    const left = iso(ox, oy + 1.3, tall)
    for (const side of [right, left]) {
      g.moveTo(corner.x, corner.y).lineTo(side.x, side.y).lineTo(down.x, down.y).lineTo(corner.x, corner.y)
      for (let k = 1; k <= 3; k++) {
        const t = k / 4
        g.moveTo(corner.x + (side.x - corner.x) * t, corner.y + (side.y - corner.y) * t).lineTo(corner.x + (down.x - corner.x) * t, corner.y + (down.y - corner.y) * t)
      }
    }
    g.stroke({ color: P.cobweb, width: 1, alpha: 0.55 })
  }
  layer.addChild(g)
}

/** Room editor: outlines the slots the chosen item can go to, on the floor, the desk or the wall. */
function drawTargets(layer: Container, room: FloorRoom, slots: FloorView['slots'], ids: readonly string[]): void {
  const [ox, oy] = room.origin
  const g = new Graphics()
  for (const id of ids) {
    const slot = slots[id]
    if (!slot) continue
    if (slot.wall) {
      const from = slot.from_tile ?? 0
      const to = from + (slot.width ?? 1)
      const z0 = slot.bottom_z ?? 2
      const z1 = z0 + 1.4
      const corners =
        slot.wall === 'right'
          ? [iso(ox + from, oy, z0), iso(ox + to, oy, z0), iso(ox + to, oy, z1), iso(ox + from, oy, z1)]
          : [iso(ox, oy + from, z0), iso(ox, oy + to, z0), iso(ox, oy + to, z1), iso(ox, oy + from, z1)]
      g.poly(pts(corners)).fill({ color: P.gold, alpha: 0.18 }).stroke({ color: P.gold, width: 2, alpha: 0.9 })
      continue
    }
    if (!slot.tile) continue
    const [tx, ty] = slot.tile
    const [w, d] = slot.kind === 'desk_surface' ? [1, 1] : (slot.footprint ?? [1, 1])
    const z = slot.kind === 'desk_surface' ? 1.02 : 0.02
    const corners = [iso(ox + tx, oy + ty, z), iso(ox + tx + w, oy + ty, z), iso(ox + tx + w, oy + ty + d, z), iso(ox + tx, oy + ty + d, z)]
    g.poly(pts(corners)).fill({ color: P.gold, alpha: 0.18 }).stroke({ color: P.gold, width: 2, alpha: 0.9 })
  }
  layer.addChild(g)
}

/** Greys the room from level 1 and dims it from level 3; `light` overrides the darkness (flicker, lights back on). */
function decayFilter(level: DecayLevel, light?: number): ColorMatrixFilter | null {
  const dark = light ?? darknessOf(level)
  if (level === 0 && dark === 0) return null
  const filter = new ColorMatrixFilter()
  filter.resolution = 'inherit'
  filter.saturate(level >= 3 ? -0.7 : level === 2 ? -0.55 : level === 1 ? -0.35 : 0, false)
  if (dark > 0) filter.brightness(1 - dark, true)
  return filter
}

/** A texture from a bundled image, through a plain <img> so no worker or fetch is involved. */
async function loadTexture(url: string): Promise<Texture> {
  const image = new Image()
  image.src = url
  await image.decode()
  // Mipmaps keep a large painting clean when it is drawn small on the map.
  return Texture.from({ resource: image, autoGenerateMipmaps: true })
}

/**
 * The front room's painting with the top of its back corner dissolved away.
 * On the map that corner stands in front of the lobby; opened up, the plaza
 * and whoever is walking across it show through. The room itself is drawn
 * whole as soon as it is opened.
 */
async function loadOpenedTexture(url: string, cut: { anchorX: number; scale: number; floor: readonly (readonly [number, number])[] }): Promise<Texture> {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return Texture.from({ resource: image, autoGenerateMipmaps: true })
  ctx.drawImage(image, 0, 0)
  const apexX = cut.anchorX + cut.floor[0]![0] * cut.scale
  const radius = OPENING_RADIUS * cut.scale
  const hole = ctx.createRadialGradient(apexX, radius * 0.12, 0, apexX, radius * 0.12, radius)
  hole.addColorStop(0, 'rgb(0 0 0 / 1)')
  hole.addColorStop(0.6, 'rgb(0 0 0 / 1)')
  hole.addColorStop(1, 'rgb(0 0 0 / 0)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = hole
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return Texture.from({ resource: canvas, autoGenerateMipmaps: true })
}
/** How far the opening reaches from the top of the front room's back corner, in logical pixels. */
const OPENING_RADIUS = 150

/** Where Nato stands in a room, and the way out of it towards the lobby, in room tiles. */
const STAND: readonly [number, number] = [4.5, 5.6]
const LOBBY: readonly [number, number] = [LOBBY_AT, LOBBY_AT]
/** The way out of a room, as the floor model defines it: the walkways are drawn along the same points. */
const wayOut = (origin: readonly [number, number]): Array<[number, number]> => wayOutOf(origin)
/** In a painted room he stands on a free spot of its painted floor. */
function standIn(roomId: string | undefined, painted: boolean): readonly [number, number] {
  return (painted && roomId && ROOM_CUT[roomId]?.nato) || STAND
}
function route(from: readonly [number, number] | null, to: readonly [number, number], stand: readonly [number, number]): Array<[number, number]> {
  const end: [number, number] = [to[0] + stand[0], to[1] + stand[1]]
  if (!from || (from[0] === to[0] && from[1] === to[1])) return [end]
  return [...wayOut(from), [LOBBY[0], LOBBY[1]], ...wayOut(to).reverse(), end]
}

/** Where the lobby's centrepiece stands (towards the back, clear of the front room's walls) and how wide it is drawn. */
const LOBBY_SPOT = LOBBY_AT
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

export interface CanvasLabel {
  id: string
  left: number
  top: number
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
  onLabels,
  onHover,
  highlights,
  onSlot,
  arranging = null,
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
  /** Screen positions (in CSS pixels of the stage) to pin a label over each room; called when the camera moves. */
  onLabels: (labels: CanvasLabel[]) => void
  /** The room under the pointer, for the tooltip; null when none. */
  onHover?: (roomId: string | null) => void
  /** Room editor: slots of the focused room to outline, and what to do when one is clicked. */
  highlights?: readonly string[]
  onSlot?: (slotId: string) => void
  /** The room being arranged: drawn from its pieces instead of as its painting. */
  arranging?: string | null
  /** Called whenever the camera moves, so things can be pinned over the floor in HTML. */
  onCamera?: (camera: CanvasCamera) => void
  /** A chat dragged from the list was dropped on a room. */
  onDropChat?: (roomId: string, chatId: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => onHover?.(hover), [hover, onHover])
  const stage = useRef<{
    app: Application
    world: Container
    rooms: Container
    nato: Sprite | null
    textures: { walk: Texture[]; sit: Texture; helpers: Record<string, Texture>; lobby: Texture; rooms: Record<string, Texture>; opened: Record<string, Texture> } | null
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
  const latest = useRef({ floor, focus, onPick, onLabels, agents, highlights, onSlot, arranging, onCamera, onDropChat })
  latest.current = { floor, focus, onPick, onLabels, agents, highlights, onSlot, arranging, onCamera, onDropChat }
  /** A room is shown as its painting unless it has none or is being arranged. */
  const isPainted = (roomId: string): boolean => ROOM_CUT[roomId] !== undefined && latest.current.arranging !== roomId
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const decayLevels = useRef(new Map<string, DecayLevel>())
  const roomLayers = useRef(new Map<string, Container>())
  const fades = useRef(new Map<string, Fade>())

  /** The camera that shows a room, or the whole floor, inside the stage. */
  const cameraFor = (roomId: string | null): Camera => {
    const el = host.current
    const width = el?.clientWidth ?? 800
    const height = el?.clientHeight ?? 500
    const room = roomId ? latest.current.floor.rooms.find((r) => r.id === roomId) : undefined
    if (!room) return fitCamera(latest.current.floor.bounds, { width, height }, 24)
    const cut = isPainted(room.id) ? ROOM_CUT[room.id] : undefined
    if (!cut) return fitCamera(boxOfRoom(room), { width, height }, 32)
    // A painted room is framed by its cut-out: the walls' top and the floor's own corners.
    const origin = iso(room.origin[0], room.origin[1])
    const xs = cut.floor.map(([x]) => origin.x + x)
    const ys = cut.floor.map(([, y]) => origin.y + y)
    return fitCamera({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: origin.y + cut.top, maxY: Math.max(...ys) }, { width, height }, 28)
  }

  // Set the scene up once.
  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    P = readPalette()
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

      const helperTextures = await Promise.all(Object.entries(HELPER_SPRITE).map(async ([id, url]) => [id, await loadTexture(url)] as const))
      const textures = {
        walk: await Promise.all(NATO_FRAMES.walk.map(loadTexture)),
        sit: await loadTexture(NATO_FRAMES.sit),
        helpers: Object.fromEntries(helperTextures),
        lobby: await loadTexture(LOBBY_SPRITE.url),
        rooms: Object.fromEntries(await Promise.all(Object.entries(ROOM_CUT).map(async ([id, cut]) => [id, await loadTexture(cut.url)] as const))),
        // Only the front-most room stands in front of the lobby.
        opened: Object.fromEntries(
          await Promise.all(
            latest.current.floor.rooms.slice(-1).flatMap((room) => {
              const cut = ROOM_CUT[room.id]
              return cut ? [loadOpenedTexture(cut.url, cut).then((texture) => [room.id, texture] as const)] : []
            })
          )
        )
      }
      const standing = textures.walk[3]!
      if (cancelled) return
      const shadow = new Graphics()
      shadow.ellipse(0, 0, 15, 6).fill({ color: P.shadow, alpha: 0.35 })
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
          latest.current.onLabels(
            latest.current.floor.rooms.map((room) => {
              const cut = isPainted(room.id) ? ROOM_CUT[room.id] : undefined
              const tall = cut ? -cut.top / 32 : room.walls.some((wall) => wall.height === WALL_FULL) ? WALL_FULL : 1
              const corner = iso(room.origin[0], room.origin[1], tall - 0.6)
              // The front room's corner is opened up on the map; its label moves onto its left wall, clear of the lobby.
              const rooms = latest.current.floor.rooms
              const opened = cut !== undefined && latest.current.focus === null && room === rooms[rooms.length - 1]
              const at = opened ? { x: corner.x - 200, y: corner.y + 104 } : corner
              return { id: room.id, left: at.x * cam.now.scale + cam.now.x, top: Math.max(34, at.y * cam.now.scale + cam.now.y) }
            })
          )
          latest.current.onCamera?.({ ...cam.now })
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
    drawWalkways(halls, floor, Object.fromEntries(floor.rooms.map((r) => [r.id, accentOf(r)])))
    for (const old of s.rooms.removeChildren()) old.destroy({ children: true })
    helpers.current = []
    const frontMost = floor.rooms[floor.rooms.length - 1]
    for (const room of floor.rooms) {
      if (room === frontMost) {
        // The lobby's centrepiece stands in front of the back rooms and behind the front one.
        const piece = new Sprite(s.textures.lobby)
        const at = iso(LOBBY_SPOT, LOBBY_SPOT)
        piece.anchor.set(0.42, 0.78)
        piece.scale.set(LOBBY_WIDTH / LOBBY_SPRITE.width)
        piece.position.set(at.x, at.y)
        piece.alpha = focus !== null ? 0.16 : 1
        s.rooms.addChild(piece)
      }
      const layer = new Container()
      // Zoomed into a room, the others step back so their walls do not crowd the view.
      layer.alpha = focus !== null && focus !== room.id ? 0.16 : 1
      s.rooms.addChild(layer)
      const painted = ROOM_CUT[room.id] !== undefined && arranging !== room.id
      // On the map the front room is drawn opened up, so the lobby behind its corner shows.
      const picture = painted ? ((focus === null && s.textures.opened[room.id]) || s.textures.rooms[room.id]) : undefined
      const cast = drawRoom(layer, room, hover === room.id && focus !== room.id, focus === room.id, picture)
      drawDecay(layer, room, painted)
      if (focus === room.id && highlights && highlights.length > 0) drawTargets(layer, room, floor.slots, highlights)
      const before = decayLevels.current.get(room.id)
      decayLevels.current.set(room.id, room.decay)
      const filter = decayFilter(room.decay)
      if (filter) layer.filters = [filter]
      roomLayers.current.set(room.id, layer)
      if (before !== undefined && before >= 3 && room.decay < 3 && !reducedMotion) {
        // Lights back on: the darkness lifts over a moment instead of vanishing. The fade
        // belongs to the room, not this layer, so a redraw mid-fade carries it on.
        const id = room.id
        fades.current.set(id, { from: darknessOf(before), start: performance.now() })
        const step = (): void => {
          const fade = fades.current.get(id)
          const current = roomLayers.current.get(id)
          if (!fade) return
          const level = decayLevels.current.get(id) ?? 0
          const dark = fadeDarkness(fade, performance.now(), LIGHTS_ON_MS)
          if (dark <= 0) {
            fades.current.delete(id)
            const settled = decayFilter(level)
            if (current) setFiltersIfAlive(current, settled ? [settled] : [])
            return
          }
          if (current) setFiltersIfAlive(current, [decayFilter(level, dark) ?? new ColorMatrixFilter()])
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
      const agent = agents[room.id]
      const cut = painted ? ROOM_CUT[room.id] : undefined
      const spotTile = cut ? [room.origin[0] + cut.helper[0], room.origin[1] + cut.helper[1]] : [room.helperSpots[0]![0] + 0.5, room.helperSpots[0]![1] + 0.5]
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
        const colour = agent.state === 'done' ? P.success : accentOf(room)
        dot.circle(spot.x, spot.y - CHARACTER_HEIGHT * 0.72 - 9, 9).fill({ color: colour, alpha: 0.28 })
        dot.circle(spot.x, spot.y - CHARACTER_HEIGHT * 0.72 - 9, 5).fill(colour).stroke({ color: P.outline, width: 1 })
        cast.addChild(dot)
      }
    }
  }, [ready, floor, hover, focus, agents, highlights, arranging])

  // A mostly dark room's light flickers on now and then (never with reduced motion).
  useEffect(() => {
    if (!ready) return
    const timers: number[] = []
    for (const room of floor.rooms) {
      if (!flickerOn(room.decay, reducedMotion)) continue
      const schedule = (): void => {
        timers.push(
          window.setTimeout(() => {
            const layer = roomLayers.current.get(room.id)
            if (layer && !layer.destroyed) {
              setFiltersIfAlive(layer, [decayFilter(room.decay, FLICKER.alpha)!])
              timers.push(window.setTimeout(() => {
                setFiltersIfAlive(layer, [decayFilter(room.decay)!])
              }, FLICKER.ms))
            }
            schedule()
          }, nextFlickerDelay(Math.random))
        )
      }
      schedule()
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [ready, floor, reducedMotion])

  // Zoom to the focused room, or back out to the whole palace.
  useEffect(() => {
    if (!ready) return
    camera.current.goal = cameraFor(focus)
    camera.current.free = false
  }, [ready, focus, floor, arranging]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const stand = standIn(natoRoom ?? undefined, natoRoom !== null && isPainted(natoRoom))
    w.path = route(w.room, target, stand)
    if (!w.room) w.path = [...wayOut(target).reverse(), ...w.path]
    w.room = target
    w.home = [target[0] + stand[0], target[1] + stand[1]]
    w.roomId = natoRoom
    w.strolling = false
  }, [ready, natoRoom, floor]) // eslint-disable-line react-hooks/exhaustive-deps

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
      else if (room && room === latest.current.focus && latest.current.onSlot) {
        // Room editor: a click on an outlined floor slot places the chosen item there.
        const focused = latest.current.floor.rooms.find((r) => r.id === room)
        const box = el.getBoundingClientRect()
        const cam = camera.current.now
        const tile = tileAt({ x: (event.clientX - box.left - cam.x) / cam.scale, y: (event.clientY - box.top - cam.y) / cam.scale })
        const slot = focused ? slotAt(latest.current.floor.slots, tile.x - focused.origin[0], tile.y - focused.origin[1]) : null
        if (slot && latest.current.highlights?.includes(slot)) latest.current.onSlot(slot)
      }
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
      latest.current.onDropChat?.(room, chatId)
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
