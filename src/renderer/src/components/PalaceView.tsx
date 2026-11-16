import { useEffect, useMemo } from 'react'
import { itemKey, itemLabel, SHELL_LABEL, trackProgress, type PalaceRoom, type TrackProgress } from '@shared/palace'
import helper from '../assets/characters/helper.png'
import nato from '../assets/characters/nato.png'
import { useStore } from '../store'
import { PalaceHub } from './PalaceHub'
import { ROOM_IMAGE, SHELL_FILTER } from './roomArt'

const MAX_TROPHIES = 5

function Trophy({ earned }: { earned: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-6 ${earned ? 'text-amber-300' : 'text-white/15'}`} aria-hidden="true">
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
        className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
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

function Room({ room, roomIds }: { room: PalaceRoom; roomIds: string[] }) {
  const { state } = room
  const image = ROOM_IMAGE[room.id]
  const chats = useStore((s) => s.chats)
  const projects = useStore((s) => s.projects)
  const streaming = useStore((s) => s.streaming)
  const startChatIn = useStore((s) => s.startChatIn)
  const selectChat = useStore((s) => s.selectChat)
  const showPalace = useStore((s) => s.showPalace)
  const projectAction = useStore((s) => s.projectAction)
  const roomChats = useMemo(() => chats.filter((c) => c.roomId === room.id), [chats, room.id])
  const roomProjects = useMemo(
    () => projects.filter((p) => p.roomId === room.id && p.state === 'active'),
    [projects, room.id]
  )
  const working = roomChats.some((c) => streaming[c.id])
  const fresh = useMemo(() => new Set(room.newItems), [room.newItems])
  const furniture = state.items.filter((item) => item.source !== 'trophy')
  const hasShelf = state.items.some((item) => item.item === 'trophy_shelf')
  const news = [
    ...(room.newShell ? [SHELL_LABEL[room.newShell]] : []),
    ...state.items.filter((item) => fresh.has(itemKey(item)) && item.source !== 'trophy').map((item) => itemLabel(item.item, roomIds)),
    ...(state.items.some((item) => fresh.has(itemKey(item)) && item.source === 'trophy') ? ['a trophy'] : [])
  ]

  return (
    <div className="palace-enter mx-auto flex max-w-6xl flex-col gap-5 px-5 py-6 @4xl:flex-row">
      <div className="min-w-0 flex-1">
        {news.length > 0 && (
          <p role="status" className="palace-new mb-3 rounded-lg bg-amber-300 px-4 py-2 text-sm font-medium text-ink">
            New in this room: {news.join(', ')}.
          </p>
        )}
        <figure className="relative overflow-hidden rounded-xl border border-white/10 bg-ink-soft">
          {image ? (
            <img
              src={image}
              alt={`${room.name}, ${SHELL_LABEL[state.shell].toLowerCase()}`}
              className={`palace-room-image block aspect-video w-full object-cover ${room.newShell ? 'revealing' : ''}`}
              style={{ filter: SHELL_FILTER[state.shell] }}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-muted">No picture for this room yet.</div>
          )}
          {image && (
            <>
              <img src={nato} alt="Nato" className="nato pointer-events-none absolute bottom-[6%] left-[44%] h-[40%]" />
              {working && (
                <img
                  src={helper}
                  alt="Claude is answering in this room"
                  className="helper pointer-events-none absolute bottom-[8%] left-[58%] h-[30%]"
                />
              )}
            </>
          )}
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              type="button"
              onClick={() => startChatIn(room.id)}
              className="rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-ink shadow hover:bg-white"
            >
              Chat here
            </button>
          </div>
          <button
            type="button"
            onClick={() => void showPalace(null)}
            className="absolute top-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-paper backdrop-blur hover:bg-black/85"
          >
            ← Palace
          </button>
          <figcaption className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs backdrop-blur">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: room.accent }} />
            {SHELL_LABEL[state.shell]}
          </figcaption>
          {hasShelf && (
            <div
              className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur"
              role="img"
              aria-label={`${state.goals.trophies} of ${MAX_TROPHIES} trophies`}
            >
              {Array.from({ length: MAX_TROPHIES }, (_, i) => (
                <Trophy key={i} earned={i < state.goals.trophies} />
              ))}
            </div>
          )}
        </figure>

        <section className="mt-5">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">In this room</h3>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="room-furniture">
            {furniture.map((item) => {
              const isNew = fresh.has(itemKey(item))
              return (
                <li
                  key={itemKey(item)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    isNew ? 'palace-new bg-amber-300 font-medium text-ink' : 'bg-white/10 text-paper'
                  }`}
                >
                  {itemLabel(item.item, roomIds)}
                  {isNew && <span className="ml-1.5 text-xs">new</span>}
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <aside className="flex shrink-0 flex-col gap-3 @4xl:w-72">
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
                    className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
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
    </div>
  )
}

/** The palace: one illustrated room at a time, filling in with streaks and finished projects. */
export function PalaceView() {
  const palace = useStore((s) => s.palace)
  const roomId = useStore((s) => s.palaceRoomId)
  const showPalace = useStore((s) => s.showPalace)
  const markRoomSeen = useStore((s) => s.markRoomSeen)
  const appError = useStore((s) => s.appError)
  const seenRooms = useStore((s) => s.seenRooms)

  // No room chosen: the palace itself, with every room around the atrium.
  const room = palace?.rooms.find((r) => r.id === roomId) ?? null
  const roomIds = useMemo(() => palace?.rooms.map((r) => r.id) ?? [], [palace])
  const hasNews = room !== null && (room.newItems.length > 0 || room.newShell !== null)

  // Looking at a room is what makes its news old. The highlight stays on screen
  // until the palace is next refreshed.
  useEffect(() => {
    if (room) void markRoomSeen(room.id)
  }, [room?.id, hasNews, markRoomSeen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 overflow-x-auto border-b border-white/10 px-5 whitespace-nowrap">
        <h1 className="text-sm font-medium">Palace</h1>
        <nav className="flex gap-1" aria-label="Rooms">
          <button
            type="button"
            onClick={() => void showPalace(null)}
            aria-current={roomId === null ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-xs ${
              roomId === null ? 'bg-white/15 text-paper' : 'text-paper/70 hover:bg-white/5'
            }`}
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
                  active ? 'bg-white/15 text-paper' : 'text-paper/70 hover:bg-white/5'
                }`}
              >
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: r.accent }} />
                {r.name}
                {isNew && !active && <span className="size-1.5 rounded-full bg-amber-300" aria-label="something new" />}
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
        {room ? (
          <Room key={room.id} room={room} roomIds={roomIds} />
        ) : palace ? (
          <PalaceHub />
        ) : (
          <p className="mt-24 text-center text-sm text-muted">Loading the palace…</p>
        )}
      </div>
    </section>
  )
}
