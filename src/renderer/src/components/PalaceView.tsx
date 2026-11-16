import { useCallback, useEffect, useMemo, useState } from 'react'
import { AGENT_LABEL, roomAgents, type RoomAgent } from '@shared/agents'
import { activeToday, currentRoomOf, itemKey, itemLabel, SHELL_LABEL, trackProgress, type PalaceRoom, type TrackProgress } from '@shared/palace'
import { useStore } from '../store'
import { ActivityStrip } from './ActivityStrip'
import { PalaceCanvas, type CanvasLabel } from './PalaceCanvas'
import { ROOM_IMAGE } from './roomArt'

const MAX_TROPHIES = 5

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
  const showReminders = useStore((s) => s.showReminders)
  const [labels, setLabels] = useState<CanvasLabel[]>([])

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
  const furniture = room?.state.items.filter((item) => item.source !== 'trophy') ?? []
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
              <figure
                key="stage"
                className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-brass/35 bg-[#1e1612]"
                data-testid="palace-stage"
                data-room={room?.id ?? ''}
              >
                <PalaceCanvas floor={palace.floor} focus={room?.id ?? null} natoRoom={natoRoom} agents={agents} onPick={pick} onLabels={setLabels} />

                {/* Room names float over the floor; they are also the keyboard way into a room. */}
                {!room &&
                  labels.map((label) => {
                    const r = palace.rooms.find((x) => x.id === label.id)
                    if (!r) return null
                    const a = agents[r.id] ?? IDLE
                    const count = projects.filter((p) => p.roomId === r.id && p.state === 'active').length
                    const isNew = !seenRooms.includes(r.id) && (r.newItems.length > 0 || r.newShell !== null)
                    const today = activeToday(r.state)
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
                          {r.state.streak.current > 0 && <span className="text-muted">{r.state.streak.current}d</span>}
                          {count > 0 && <span className="text-muted">· {count} project{count === 1 ? '' : 's'}</span>}
                          {isNew && <span className="palace-new rounded-full bg-gold px-1.5 text-[10px] font-semibold text-ink">New</span>}
                        </span>
                      </button>
                    )
                  })}

                {!room && (
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void selectChat(null)}
                      className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-ink shadow hover:bg-brass-light"
                    >
                      New chat
                    </button>
                    <button
                      type="button"
                      onClick={() => void showReminders()}
                      className="rounded-full border border-brass/50 bg-walnut/85 px-3 py-1.5 text-xs text-paper shadow backdrop-blur hover:bg-raised"
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
                <span className="sr-only" role="img" aria-label={natoRoomName ? `Nato, in the ${natoRoomName}` : 'Nato, in the lobby'} />
              </figure>

              {room ? (
                <section key="furniture" className="mt-5">
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">In this room</h3>
                  <ul className="mt-2 flex flex-wrap gap-2" data-testid="room-furniture">
                    {furniture.map((item) => {
                      const isNew = fresh.has(itemKey(item))
                      return (
                        <li
                          key={itemKey(item)}
                          className={`rounded-full px-3 py-1 text-sm ${isNew ? 'palace-new bg-gold font-medium text-ink' : 'bg-raised text-paper'}`}
                        >
                          {itemLabel(item.item, roomIds)}
                          {isNew && <span className="ml-1.5 text-xs">new</span>}
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-muted">The room is shown as its painting. It starts grey and gains its colour as the streak grows.</p>
                </section>
              ) : (
                <p key="where" className="mt-4 text-center text-sm text-muted" role="status">
                  {natoRoomName ? `Nato is in the ${natoRoomName}, where you last worked. ` : ''}
                  {activeRooms.length === 0
                    ? 'No room has a chat yet today.'
                    : `Today you chatted in the ${activeRooms.map((r) => r.name).join(' and the ')}.`}{' '}
                  Click a room to go in. Scroll to zoom, drag to move.
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
