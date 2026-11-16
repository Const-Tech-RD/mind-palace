import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_LABEL, roomAgents, type RoomAgent } from '@shared/agents'
import { activeToday, currentRoomOf, decayText, itemKey, itemLabel, SHELL_LABEL, trackProgress, type PalaceRoom, type TrackProgress } from '@shared/palace'
import { useStore } from '../store'
import { ActivityStrip } from './ActivityStrip'
import { iso } from '@shared/floor'
import { CHAT_DRAG_TYPE, PalaceCanvas, type CanvasCamera, type CanvasLabel } from './PalaceCanvas'
import { HOTSPOT_ACTION, ROOM_HOTSPOTS, type Hotspot } from './roomHotspots'
import { RoomPanel } from './RoomPanel'
import { PalaceGuide, usePalaceGuide } from './PalaceGuide'
import { PalaceList, RoomSummary } from './PalaceList'
import { InventoryDrawer } from './InventoryDrawer'
import { ROOM_CUT, ROOM_IMAGE } from './roomArt'

const MAX_TROPHIES = 5
/** How long Nato gets to walk towards a thing before it opens. */
const WALK_TO_THING_MS = 450

function Trophy({ earned }: { earned: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-6 ${earned ? 'text-gold' : 'text-paper/15'}`} aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.35A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.35 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.73V7Zm10 0v2.73A2 2 0 0 0 18 8V7h-1Z"
      />
    </svg>
  )
}

function TrackCard({ title, unit, progress, best }: { title: string; unit: string; progress: TrackProgress; best?: number }) {
  return (
    <section className="rounded-lg bg-ink-soft p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
        {best !== undefined && best > progress.value && <span className="text-xs text-muted">best {best}</span>}
      </div>
      <p className="mt-1">
        <span className="text-2xl font-semibold">{progress.value}</span>{' '}
        <span className="text-sm text-muted">
          {unit}
          {progress.value === 1 ? '' : 's'}
          {progress.target !== null ? ` of ${progress.target}` : ''}
        </span>
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-paper/10"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={progress.target ?? progress.value}
        aria-valuenow={progress.value}
      >
        <div className="h-full rounded-full bg-paper" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{progress.caption}</p>
    </section>
  )
}

const RECENT_CHATS = 6
const IDLE: RoomAgent = { state: 'idle', chatId: null, bubble: '' }

/** What the side of a room shows: its painting, projects, chats and the two tracks. */
function RoomAside({ room, roomIds }: { room: PalaceRoom; roomIds: string[] }) {
  const { state } = room
  const chats = useStore((s) => s.chats)
  const projects = useStore((s) => s.projects)
  const selectChat = useStore((s) => s.selectChat)
  const projectAction = useStore((s) => s.projectAction)
  const roomChats = useMemo(() => chats.filter((c) => c.roomId === room.id), [chats, room.id])
  const roomProjects = useMemo(() => projects.filter((p) => p.roomId === room.id && p.state === 'active'), [projects, room.id])
  return (
      <aside className="flex shrink-0 flex-col gap-3 @4xl:w-72">
        {ROOM_IMAGE[room.id] && (
          <img
            src={ROOM_IMAGE[room.id]}
            alt={`${room.name}, as painted`}
            className="aspect-video w-full rounded-lg border border-brass/35 object-cover"
          />
        )}
        <section className="rounded-lg bg-ink-soft p-4">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
            Projects here · {roomProjects.length}
          </h3>
          {roomProjects.length === 0 ? (
            <p className="mt-2 text-xs text-muted">No active project in this room.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {roomProjects.slice(0, RECENT_CHATS).map((project) => (
                <li key={project.id} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => project.chatIds[0] && void selectChat(project.chatIds[0])}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    title={project.title}
                  >
                    {project.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void projectAction(project.id, 'done')}
                    aria-label={`Mark ${project.title} done`}
                    className="shrink-0 rounded-md bg-paper/10 px-2 py-0.5 text-xs hover:bg-paper/20"
                  >
                    Done
                  </button>
                </li>
              ))}
              {roomProjects.length > RECENT_CHATS && (
                <li className="text-xs text-muted">and {roomProjects.length - RECENT_CHATS} more in Projects</li>
              )}
            </ul>
          )}
        </section>
        <section className="rounded-lg bg-ink-soft p-4">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Recent chats · {roomChats.length}</h3>
          {roomChats.length === 0 ? (
            <p className="mt-2 text-xs text-muted">Nothing filed here yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {roomChats.slice(0, RECENT_CHATS).map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => void selectChat(chat.id)}
                    className="block w-full truncate text-left text-sm text-paper/85 hover:underline"
                    title={chat.title}
                  >
                    {chat.title || 'New chat'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <TrackCard title="Streak" unit="day" progress={trackProgress(state, 'streak', roomIds)} best={state.streak.best} />
        <TrackCard title="Finished projects" unit="goal" progress={trackProgress(state, 'goals', roomIds)} />
        <p className="px-1 text-xs leading-relaxed text-muted">
          A day counts when you chat in this room. Weekends never break a streak. What you unlock stays, even if the
          streak ends.
        </p>
      </aside>
  )
}

/**
 * The palace: one connected floor with the four rooms, drawn on a canvas.
 * With no room chosen it shows the whole floor; choosing a room zooms into it
 * and shows that room's details beside it.
 */
export function PalaceView() {
  const palace = useStore((s) => s.palace)
  const roomId = useStore((s) => s.palaceRoomId)
  const showPalace = useStore((s) => s.showPalace)
  const markRoomSeen = useStore((s) => s.markRoomSeen)
  const appError = useStore((s) => s.appError)
  const seenRooms = useStore((s) => s.seenRooms)
  const chats = useStore((s) => s.chats)
  const streaming = useStore((s) => s.streaming)
  const finished = useStore((s) => s.finished)
  const projects = useStore((s) => s.projects)
  const reminders = useStore((s) => s.reminders.length)
  const selectChat = useStore((s) => s.selectChat)
  const startChatIn = useStore((s) => s.startChatIn)
  const showProjects = useStore((s) => s.showProjects)
  const moveChat = useStore((s) => s.moveChat)
  const projectAction = useStore((s) => s.projectAction)
  const [labels, setLabels] = useState<CanvasLabel[]>([])
  const [camera, setCamera] = useState<CanvasCamera | null>(null)
  /** The thing that was clicked and whose card is open; `roomId` null is the palace-wide reminders card. */
  const [panel, setPanel] = useState<{ roomId: string | null; hotspot: Hotspot } | null>(null)
  const closePanel = useCallback(() => setPanel(null), [])
  const guide = usePalaceGuide()
  const [walkTo, setWalkTo] = useState<{ x: number; y: number; n: number } | null>(null)
  const walkTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(walkTimer.current), [])
  const dropChat = useCallback((toRoom: string, chatId: string) => void moveChat(chatId, toRoom), [moveChat])
  const refreshPalace = useStore((s) => s.refreshPalace)
  const [hovered, setHovered] = useState<string | null>(null)
  const place = useStore((s) => s.place)
  const resetPlacement = useStore((s) => s.resetPlacement)
  // Room editor: open while a room is in view; `selected` is the item being moved.
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    setEditing(false)
    setSelected(null)
    setPanel(null)
    setWalkTo(null)
    window.clearTimeout(walkTimer.current)
  }, [roomId])
  // Map or plain list, remembered per viewer; reduced motion starts on the list until someone chooses.
  const [mode, setMode] = useState<'scene' | 'list'>(() => {
    try {
      const saved = localStorage.getItem('palace.mode')
      if (saved === 'scene' || saved === 'list') return saved
    } catch {
      // Storage can be unavailable; fall through to the default.
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'list' : 'scene'
  })
  const chooseMode = (next: 'scene' | 'list'): void => {
    setMode(next)
    try {
      localStorage.setItem('palace.mode', next)
    } catch {
      // Not remembered; it still switches.
    }
  }
  const projectTitle = (id: string | null): string | null => (id ? (projects.find((p) => p.id === id)?.title ?? null) : null)
  // The focused room's back walls rise and show what hangs on them: ask for the floor with that focus.
  useEffect(() => {
    void refreshPalace()
  }, [roomId, refreshPalace])

  const room = palace?.rooms.find((r) => r.id === roomId) ?? null
  const roomIds = useMemo(() => palace?.rooms.map((r) => r.id) ?? [], [palace])
  const hasNews = room !== null && (room.newItems.length > 0 || room.newShell !== null)
  const agents = useMemo(() => roomAgents(chats, streaming, roomIds, finished), [chats, streaming, roomIds, finished])
  /** Nato is in the room being looked at; otherwise in the room last worked in. */
  const home = useMemo(() => currentRoomOf(chats, roomIds), [chats, roomIds])
  const natoRoom = room?.id ?? home
  const natoRoomName = palace?.rooms.find((r) => r.id === natoRoom)?.name
  const activeProjects = projects.filter((p) => p.state === 'active').length
  const pick = useCallback((id: string) => void showPalace(id), [showPalace])

  /**
   * A room has two looks: its painting, and its pieces. The pieces show while
   * the room is being arranged, and always for a room that has no painting.
   */
  const painted = room !== null && !editing && ROOM_CUT[room.id] !== undefined
  // The things in a painted room that can be clicked, pinned over the floor.
  const floorRoom = palace?.floor.rooms.find((r) => r.id === room?.id)
  const hotspots =
    painted && room && floorRoom && camera
      ? (ROOM_HOTSPOTS[room.id] ?? []).map((hotspot) => {
          const origin = iso(floorRoom.origin[0], floorRoom.origin[1])
          return { hotspot, left: (origin.x + hotspot.at[0]) * camera.scale + camera.x, top: (origin.y + hotspot.at[1]) * camera.scale + camera.y }
        })
      : []
  const openHotspot = (hotspot: Hotspot): void => {
    if (!room) return
    if (panel?.hotspot.id === hotspot.id) {
      setPanel(null)
      return
    }
    // Nato walks over to the thing first; what it does happens when he is on his way there.
    const roomIdNow = room.id
    setWalkTo((prev) => ({ x: hotspot.at[0], y: hotspot.at[1], n: (prev?.n ?? 0) + 1 }))
    window.clearTimeout(walkTimer.current)
    walkTimer.current = window.setTimeout(
      () => {
        if (hotspot.kind === 'chat') startChatIn(roomIdNow)
        else if (hotspot.kind === 'exit') void showPalace(null)
        else setPanel({ roomId: roomIdNow, hotspot })
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : WALK_TO_THING_MS
    )
  }
  const REMINDERS_CARD: Hotspot = { id: 'palace-reminders', kind: 'reminders', thing: 'The whole palace', at: [0, 0] }

  // Looking at a room is what makes its news old. The highlight stays on screen
  // until the palace is next refreshed.
  useEffect(() => {
    if (room) void markRoomSeen(room.id)
  }, [room?.id, hasNews, markRoomSeen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!room) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && !event.defaultPrevented && !target?.closest('input, textarea, select, [role="dialog"]')) void showPalace(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room?.id, showPalace]) // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = useMemo(() => new Set(room?.newItems ?? []), [room])
  // What stands in the room as the user arranged it (hidden and replaced things are in the inventory).
  const furniture = room?.placed.filter((item) => item.source !== 'trophy') ?? []
  const hasShelf = room?.state.items.some((item) => item.item === 'trophy_shelf') ?? false
  const news = room
    ? [
        ...(room.newShell ? [SHELL_LABEL[room.newShell]] : []),
        ...room.state.items.filter((item) => fresh.has(itemKey(item)) && item.source !== 'trophy').map((item) => itemLabel(item.item, roomIds)),
        ...(room.state.items.some((item) => fresh.has(itemKey(item)) && item.source === 'trophy') ? ['a trophy'] : [])
      ]
    : []
  const agent = room ? (agents[room.id] ?? IDLE) : IDLE
  const activeRooms = palace?.rooms.filter((r) => activeToday(r.state)) ?? []

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 overflow-x-auto border-b border-brass/25 px-5 whitespace-nowrap [scrollbar-width:none]">
        <h1 className="text-base font-semibold">Palace</h1>
        <nav className="flex gap-1" aria-label="Rooms">
          <button
            type="button"
            onClick={() => void showPalace(null)}
            aria-current={roomId === null ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-xs ${roomId === null ? 'bg-raised text-paper' : 'text-paper/70 hover:bg-paper/5'}`}
          >
            All rooms
          </button>
          {palace?.rooms.map((r) => {
            const active = r.id === roomId
            const isNew = !seenRooms.includes(r.id) && (r.newItems.length > 0 || r.newShell !== null)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => void showPalace(r.id)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(CHAT_DRAG_TYPE)) e.preventDefault()
                }}
                onDrop={(e) => {
                  const chatId = e.dataTransfer.getData(CHAT_DRAG_TYPE)
                  if (chatId) {
                    e.preventDefault()
                    dropChat(r.id, chatId)
                  }
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  active ? 'bg-raised text-paper' : 'text-paper/70 hover:bg-paper/5'
                }`}
              >
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: r.accent }} />
                {r.name}
                {isNew && !active && <span className="size-1.5 rounded-full bg-gold" aria-label="something new" />}
              </button>
            )
          })}
        </nav>
        {!room && palace && (
          <div className="ml-auto flex shrink-0 gap-1.5" data-testid="palace-shortcuts">
          <button
            type="button"
            onClick={guide.show}
            aria-label="How the palace works"
            title="How the palace works"
            className="flex size-7 items-center justify-center self-center rounded-full border border-brass/50 text-xs font-bold text-muted hover:bg-raised hover:text-paper"
          >
            ?
          </button>
          <button
            type="button"
            onClick={() => void selectChat(null)}
            className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-ink shadow hover:bg-brass-light"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => chooseMode(mode === 'scene' ? 'list' : 'scene')}
            aria-pressed={mode === 'list'}
            className="rounded-full border border-brass/50 bg-walnut/90 px-3 py-1.5 text-xs font-semibold hover:bg-raised"
          >
            {mode === 'scene' ? 'List view' : 'Map view'}
          </button>
          <button
            type="button"
            onClick={() => setPanel(panel?.hotspot.id === REMINDERS_CARD.id ? null : { roomId: null, hotspot: REMINDERS_CARD })}
            aria-expanded={panel?.hotspot.id === REMINDERS_CARD.id}
            className={`rounded-full border px-3 py-1.5 text-xs shadow backdrop-blur ${
              reminders > 0 ? 'reminder-waiting border-gold bg-walnut/85 text-gold hover:bg-raised' : 'border-brass/50 bg-walnut/85 text-paper hover:bg-raised'
            }`}
          >
            {reminders} reminder{reminders === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            onClick={() => void showProjects()}
            className="rounded-full border border-brass/50 bg-walnut/85 px-3 py-1.5 text-xs text-paper shadow backdrop-blur hover:bg-raised"
          >
            {activeProjects} active project{activeProjects === 1 ? '' : 's'}
          </button>
        </div>
        )}
      </header>
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        {appError && (
          <p role="alert" className="mx-5 mt-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
            {appError}
          </p>
        )}
        {!palace ? (
          <p className="mt-24 text-center text-sm text-muted">Loading the palace…</p>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5 @4xl:flex-row">
            <div className="min-w-0 flex-1">
              {news.length > 0 && (
                <p key="news" role="status" className="palace-new mb-3 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-ink">
                  New in this room: {news.join(', ')}.
                </p>
              )}
              {room && room.decay.level > 0 && room.decay.projectId && (
                <div key="dust" data-testid="room-dust" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brass/40 bg-ink-soft px-4 py-2 text-sm">
                  <p className="min-w-0 flex-1">
                    <span className="font-semibold">This room is gathering dust.</span>{' '}
                    <span className="text-muted">
                      “{projectTitle(room.decay.projectId) ?? 'A project'}” has been quiet for {room.decay.weekdaysQuiet} weekdays. Work on it, or put it away, and
                      the light comes back.
                    </span>
                  </p>
                  {(() => {
                    const project = projects.find((p) => p.id === room.decay.projectId)
                    const chatId = project?.chatIds[0]
                    return (
                      <>
                        {chatId && (
                          <button type="button" onClick={() => void selectChat(chatId)} className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink hover:bg-brass-light">
                            Open it
                          </button>
                        )}
                        {(['pause', 'done', 'drop'] as const).map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => void projectAction(room.decay.projectId!, action)}
                            className="rounded-full border border-brass/50 px-3 py-1 text-xs hover:bg-raised"
                          >
                            {action === 'pause' ? 'Pause' : action === 'done' ? 'Done' : 'Drop'}
                          </button>
                        ))}
                      </>
                    )
                  })()}
                </div>
              )}
              <figure
                key="stage"
                className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-brass/35 bg-ink"
                data-testid="palace-stage"
                data-room={room?.id ?? ''}
              >
                {mode === 'list' && !room ? (
                  <div className="absolute inset-0 overflow-y-auto pt-12">
                    <PalaceList rooms={palace.rooms} projectTitle={projectTitle} onOpen={(id) => void showPalace(id)} />
                  </div>
                ) : (
                  <PalaceCanvas floor={palace.floor} focus={room?.id ?? null} natoRoom={natoRoom} agents={agents} onPick={pick}
                    onLabels={setLabels}
                    onHover={setHovered}
                    arranging={editing && room ? room.id : null}
                    onCamera={setCamera}
                    walkTo={walkTo}
                    onDropChat={dropChat}
                    highlights={editing && selected && room ? (room.editor.targets[selected] ?? []) : undefined}
                    onSlot={(slot) => {
                      if (!room || !selected) return
                      void place({ roomId: room.id, instance: selected, slot })
                      setSelected(null)
                    }}
                  />
                )}

                {/* Room names float over the floor; they are also the keyboard way into a room. */}
                {!room && mode === 'scene' && hovered && (() => {
                  const r = palace.rooms.find((x) => x.id === hovered)
                  const label = labels.find((l) => l.id === hovered)
                  if (!r || !label) return null
                  return (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-lg border border-brass/50 bg-walnut/95 px-3 py-2 shadow-lg"
                      style={{ left: label.left, top: label.top + 8 }}
                    >
                      <RoomSummary room={r} decay={decayText(r.decay, projectTitle(r.decay.projectId))} roomIds={roomIds} />
                    </div>
                  )
                })()}
                {!room &&
                  mode === 'scene' &&
                  labels.map((label) => {
                    const r = palace.rooms.find((x) => x.id === label.id)
                    if (!r) return null
                    const a = agents[r.id] ?? IDLE
                    const count = projects.filter((p) => p.roomId === r.id && p.state === 'active').length
                    const isNew = !seenRooms.includes(r.id) && (r.newItems.length > 0 || r.newShell !== null)
                    const today = activeToday(r.state)
                    const onWalls = palace.floor.rooms.find((x) => x.id === r.id)?.hiddenWallItems ?? 0
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void showPalace(r.id)}
                        aria-label={`${r.name}: ${r.state.streak.current}-day streak, ${SHELL_LABEL[r.state.shell].toLowerCase()}. Enter`}
                        data-active-today={today}
                        data-agent={r.id}
                        data-state={a.state}
                        className="palace-wing absolute flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1"
                        style={{ left: label.left, top: label.top }}
                      >
                        {a.state !== 'idle' && (
                          <span className="agent-bubble max-w-44 truncate rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink shadow">
                            {a.state === 'writing' ? AGENT_LABEL.writing : a.bubble}
                          </span>
                        )}
                        <span
                          className="flex items-center gap-1.5 rounded-full border border-brass/50 bg-walnut/90 px-2.5 py-1 text-xs shadow-lg backdrop-blur"
                          style={today ? { boxShadow: `0 0 0 1px ${r.accent}, 0 0 14px -2px ${r.accent}` } : undefined}
                        >
                          <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: r.accent }} />
                          <span className="font-semibold">{r.name}</span>
                          {onWalls > 0 && (
                            <span className="text-[10px] text-muted" title="On a low wall: shown when you open the room">
                              +{onWalls} on the walls
                            </span>
                          )}
                          {r.state.streak.current > 0 && <span className="text-muted">{r.state.streak.current}d</span>}
                          {count > 0 && <span className="text-muted">· {count} project{count === 1 ? '' : 's'}</span>}
                          {r.decay.level > 0 && (
                            <span className="rounded-full bg-paper/15 px-1.5 text-[10px] text-muted" title={decayText(r.decay, projectTitle(r.decay.projectId)) ?? undefined}>
                              dusty
                            </span>
                          )}
                          {isNew && <span className="palace-new rounded-full bg-gold px-1.5 text-[10px] font-semibold text-ink">New</span>}
                        </span>
                      </button>
                    )
                  })}

                {room && (
                  <>
                    <button
                      type="button"
                      onClick={() => void showPalace(null)}
                      className="absolute top-3 left-3 rounded-full border border-brass/50 bg-walnut/85 px-3 py-1.5 text-xs text-paper backdrop-blur hover:bg-raised"
                    >
                      ← Palace
                    </button>
                    <div className="absolute top-3 right-3 flex gap-2">
                      {agent.chatId && (
                        <button
                          type="button"
                          onClick={() => void selectChat(agent.chatId)}
                          className="rounded-full border border-brass/50 bg-walnut/85 px-3 py-1.5 text-xs text-paper backdrop-blur hover:bg-raised"
                        >
                          {agent.state === 'done' ? 'Read the answer' : 'Watch the answer'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startChatIn(room.id)}
                        className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-ink shadow hover:bg-brass-light"
                      >
                        Chat here
                      </button>
                    </div>
                    {agent.state !== 'idle' && agent.bubble && (
                      <p
                        className="agent-bubble absolute bottom-12 left-1/2 max-w-[70%] -translate-x-1/2 rounded-xl bg-paper px-3 py-1.5 text-xs leading-snug text-ink shadow-lg"
                        data-agent={room.id}
                        data-state={agent.state}
                      >
                        {agent.bubble}
                      </p>
                    )}
                    <figcaption className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-brass/50 bg-walnut/85 px-3 py-1 text-xs backdrop-blur">
                      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: room.accent }} />
                      {SHELL_LABEL[room.state.shell]}
                    </figcaption>
                    {hasShelf && (
                      <div
                        className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-full border border-brass/50 bg-walnut/85 px-2.5 py-1 backdrop-blur"
                        role="img"
                        aria-label={`${room.state.goals.trophies} of ${MAX_TROPHIES} trophies`}
                      >
                        {Array.from({ length: MAX_TROPHIES }, (_, i) => (
                          <Trophy key={i} earned={i < room.state.goals.trophies} />
                        ))}
                      </div>
                    )}
                  </>
                )}
                {/* The things in a painted room that can be clicked. */}
                {hotspots.map(({ hotspot, left, top }) => {
                  const open = panel?.hotspot.id === hotspot.id
                  const waiting = hotspot.kind === 'reminders' && reminders > 0
                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      onClick={() => openHotspot(hotspot)}
                      aria-label={`${hotspot.thing}: ${HOTSPOT_ACTION[hotspot.kind]}`}
                      aria-expanded={hotspot.kind === 'chat' || hotspot.kind === 'exit' ? undefined : open}
                      data-hotspot={hotspot.kind}
                      className={`hotspot group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center ${open ? 'open' : ''} ${waiting ? 'waiting' : ''}`}
                      style={{ left, top }}
                    >
                      <span className={`hotspot-dot block size-4 rounded-full border-2 border-paper shadow ${waiting ? 'bg-gold' : ''}`} style={waiting ? undefined : { backgroundColor: room?.accent }} />
                      <span className="hotspot-tip pointer-events-none absolute top-1/2 left-full ml-1.5 -translate-y-1/2 rounded-full border border-brass/60 bg-walnut/95 px-2 py-0.5 text-[11px] whitespace-nowrap text-paper shadow">
                        {HOTSPOT_ACTION[hotspot.kind]}
                        {hotspot.kind === 'reminders' && reminders > 0 ? ` · ${reminders}` : ''}
                      </span>
                    </button>
                  )
                })}

                {panel &&
                  (() => {
                    const pinned = panel.roomId === null ? { left: 12, top: 52 } : (hotspots.find((h) => h.hotspot.id === panel.hotspot.id) ?? { left: 12, top: 52 })
                    return (
                      <RoomPanel
                        kind={panel.hotspot.kind as 'projects' | 'finished' | 'chats' | 'unsorted' | 'reminders'}
                        roomId={panel.roomId}
                        thing={panel.hotspot.thing}
                        left={Math.max(12, pinned.left - 20)}
                        top={Math.max(12, pinned.top + 14)}
                        onClose={closePanel}
                      />
                    )
                  })()}

                {guide.open && <PalaceGuide onClose={guide.close} />}

                <span className="sr-only" role="img" aria-label={natoRoomName ? `Nato, in the ${natoRoomName}` : 'Nato, in the lobby'} />
              </figure>

              {room && editing ? (
                <div key="editor" className="mt-5">
                  <InventoryDrawer
                    room={room}
                    roomIds={roomIds}
                    selected={selected}
                    onSelect={setSelected}
                    onPlace={(instance, slot) => {
                      void place({ roomId: room.id, instance, slot, hidden: false })
                      setSelected(null)
                    }}
                    onVariant={(instance, variant) => void place({ roomId: room.id, instance, variant })}
                    onHide={(instance, hidden) => void place({ roomId: room.id, instance, hidden })}
                    onReset={(instance) => void resetPlacement(room.id, instance)}
                    onDone={() => {
                      setEditing(false)
                      setSelected(null)
                    }}
                  />
                </div>
              ) : room ? (
                <section key="furniture" className="mt-5">
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">In this room</h3>
                  <ul className="mt-2 flex flex-wrap gap-2" data-testid="room-furniture">
                    {furniture.map((item) => {
                      const isNew = fresh.has(item.instance)
                      return (
                        <li
                          key={item.instance}
                          className={`rounded-full px-3 py-1 text-sm ${isNew ? 'palace-new bg-gold font-medium text-ink' : 'bg-raised text-paper'}`}
                        >
                          {itemLabel(item.item, roomIds)}
                          {isNew && <span className="ml-1.5 text-xs">new</span>}
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-muted">
                    The room is shown as its painting, which gains its colour as the streak grows. Arrange room shows it as its pieces, plain blocks
                    until their drawings exist, so you can move them.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel(null)
                      setEditing(true)
                    }}
                    className="mt-3 rounded-full border border-brass/50 px-3 py-1.5 text-xs font-semibold hover:bg-raised"
                  >
                    Arrange room{room.inventory.length > 0 ? ` · ${room.inventory.length} in the inventory` : ''}
                  </button>
                </section>
              ) : (
                <p key="where" className="mt-4 text-center text-sm text-muted" role="status">
                  {natoRoomName ? `Nato is in the ${natoRoomName}, where you last worked. ` : ''}
                  {activeRooms.length === 0
                    ? 'No room has a chat yet today.'
                    : `Today you chatted in the ${activeRooms.map((r) => r.name).join(' and the ')}.`}{' '}
                  Click a room to go in. Drag a chat from the list onto a room to file it there.
                </p>
              )}
            </div>
            {room && <RoomAside room={room} roomIds={roomIds} />}
          </div>
        )}
      </div>
      <ActivityStrip />
    </section>
  )
}
