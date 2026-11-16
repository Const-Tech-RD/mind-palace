import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShellTier } from '@shared/catalog'
import { activeToday, currentRoomOf, SHELL_LABEL, type PalaceRoom } from '@shared/palace'
import nato from '../assets/characters/nato.png'
import helper from '../assets/characters/helper.png'
import atrium from '../assets/rooms/atrium.jpg'
import { useStore } from '../store'
import { ROOM_IMAGE, SHELL_FILTER } from './roomArt'

/**
 * Where each room sits around the atrium, in percent of the stage, and where
 * the character stands when he is there. Rooms the layout does not know are
 * not drawn; the catalog has these four.
 */
const WING: Record<string, { left: number; top: number; path: [number, number]; stand: [number, number] }> = {
  art: { left: 36, top: 1, path: [50, 14], stand: [62, 27] },
  coding: { left: 1, top: 35, path: [15, 50], stand: [27, 63] },
  music: { left: 71, top: 35, path: [85, 50], stand: [73, 63] },
  mailroom: { left: 36, top: 72, path: [50, 86], stand: [62, 99] }
}
const WING_WIDTH = 28
const ATRIUM = { left: 33, top: 33, width: 34, stand: [50, 63] as [number, number] }
const WALK_MS = 700

function Wing({ room, onEnter, working }: { room: PalaceRoom; onEnter: () => void; working: boolean }) {
  const place = WING[room.id]
  const activeProjects = useStore((s) => s.projects.filter((p) => p.roomId === room.id && p.state === 'active').length)
  const seen = useStore((s) => s.seenRooms.includes(room.id))
  if (!place) return null
  const isNew = !seen && (room.newItems.length > 0 || room.newShell !== null)
  const shell: ShellTier = room.state.shell
  const today = activeToday(room.state)

  return (
    <button
      type="button"
      onClick={onEnter}
      aria-label={`${room.name}: ${room.state.streak.current}-day streak, ${SHELL_LABEL[shell].toLowerCase()}. Enter`}
      className="palace-wing absolute overflow-hidden rounded-xl border border-white/15 bg-ink-soft text-left shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      style={{
        left: `${place.left}%`,
        top: `${place.top}%`,
        width: `${WING_WIDTH}%`,
        boxShadow: today ? `0 0 0 1px ${room.accent}, 0 0 22px -4px ${room.accent}` : undefined
      }}
    >
      <img
        src={ROOM_IMAGE[room.id]}
        alt=""
        className="block aspect-video w-full object-cover"
        style={{ filter: SHELL_FILTER[shell] }}
      />
      {working && <img src={helper} alt="Claude is answering here" className="helper absolute right-[8%] bottom-[22%] h-[38%]" />}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/85 to-transparent px-2.5 pt-5 pb-1.5 text-xs">
        <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: room.accent }} />
        <span className="truncate font-medium">{room.name}</span>
        <span className="ml-auto shrink-0 text-paper/80">
          {room.state.streak.current > 0 ? `${room.state.streak.current}-day streak` : 'no streak'}
        </span>
      </span>
      <span className="absolute top-1.5 left-1.5 flex gap-1 text-[10px]">
        {isNew && <span className="palace-new rounded-full bg-amber-300 px-1.5 py-0.5 font-medium text-ink">New</span>}
        {activeProjects > 0 && (
          <span className="rounded-full bg-black/65 px-1.5 py-0.5 text-paper">
            {activeProjects} project{activeProjects === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </button>
  )
}

/** The whole palace: the atrium in the middle, a room on each side, and Nato wherever he last worked. */
export function PalaceHub() {
  const palace = useStore((s) => s.palace)
  const chats = useStore((s) => s.chats)
  const streaming = useStore((s) => s.streaming)
  const reminders = useStore((s) => s.reminders.length)
  const activeProjects = useStore((s) => s.projects.filter((p) => p.state === 'active').length)
  const showPalace = useStore((s) => s.showPalace)
  const showProjects = useStore((s) => s.showProjects)
  const showReminders = useStore((s) => s.showReminders)
  const selectChat = useStore((s) => s.selectChat)

  const rooms = useMemo(() => palace?.rooms.filter((r) => WING[r.id]) ?? [], [palace])
  const roomIds = useMemo(() => rooms.map((r) => r.id), [rooms])
  const home = useMemo(() => currentRoomOf(chats, roomIds), [chats, roomIds])
  /** Rooms where Claude is writing an answer right now. */
  const working = useMemo(
    () => new Set(chats.filter((c) => streaming[c.id] && c.roomId).map((c) => c.roomId as string)),
    [chats, streaming]
  )

  // Nato starts in the atrium and walks to the room he last worked in.
  const [at, setAt] = useState<string | null>(null)
  const [facingLeft, setFacingLeft] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const position = at && WING[at] ? WING[at].stand : ATRIUM.stand

  const walkTo = (target: string | null): void => {
    const next = target && WING[target] ? WING[target].stand : ATRIUM.stand
    if (next[0] !== position[0]) setFacingLeft(next[0] < position[0])
    setAt(target)
  }

  useEffect(() => {
    const id = window.setTimeout(() => walkTo(home), 250)
    return () => window.clearTimeout(id)
  }, [home]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const enter = (roomId: string): void => {
    window.clearTimeout(timer.current)
    if (at === roomId) {
      void showPalace(roomId)
      return
    }
    // He walks over first; the room opens when he gets there.
    walkTo(roomId)
    timer.current = window.setTimeout(() => void showPalace(roomId), WALK_MS)
  }

  const activeRooms = rooms.filter((r) => activeToday(r.state))
  const where = rooms.find((r) => r.id === at)

  return (
    <div className="palace-enter mx-auto flex max-w-5xl flex-col gap-4 px-5 py-6">
      <div className="relative aspect-[16/10] w-full" data-testid="palace-stage">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          {rooms.map((room) => {
            const [x, y] = WING[room.id]!.path
            const today = activeToday(room.state)
            return (
              <line
                key={room.id}
                x1={50}
                y1={50}
                x2={x}
                y2={y}
                stroke={room.accent}
                strokeWidth={today ? 0.9 : 0.5}
                strokeOpacity={today ? 0.9 : 0.3}
                vectorEffect="non-scaling-stroke"
                className={`palace-path ${today ? 'flowing' : ''}`}
                style={{ strokeWidth: today ? 3 : 2 }}
              />
            )
          })}
        </svg>

        {rooms.map((room) => (
          <Wing key={room.id} room={room} working={working.has(room.id)} onEnter={() => enter(room.id)} />
        ))}

        <div
          className="absolute overflow-hidden rounded-xl border border-amber-300/40 bg-ink-soft shadow-lg"
          style={{ left: `${ATRIUM.left}%`, top: `${ATRIUM.top}%`, width: `${ATRIUM.width}%` }}
        >
          <img src={atrium} alt="The atrium at the centre of the palace" className="block aspect-video w-full object-cover" />
          <div className="absolute inset-x-0 top-0 flex flex-wrap justify-center gap-1.5 p-2">
            <button
              type="button"
              onClick={() => void selectChat(null)}
              className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink shadow hover:bg-white"
            >
              New chat
            </button>
            <button
              type="button"
              onClick={() => void showReminders()}
              className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-paper shadow backdrop-blur hover:bg-black/90"
            >
              {reminders} reminder{reminders === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => void showProjects()}
              className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-paper shadow backdrop-blur hover:bg-black/90"
            >
              {activeProjects} active project{activeProjects === 1 ? '' : 's'}
            </button>
          </div>
        </div>

        <div
          className="nato-walker pointer-events-none absolute h-[18%]"
          style={{ left: `${position[0]}%`, top: `${position[1]}%`, transform: 'translate(-50%, -100%)' }}
        >
          <img
            src={nato}
            alt={where ? `Nato, in the ${where.name}` : 'Nato, in the atrium'}
            className="nato h-full"
            style={{ transform: facingLeft ? 'scaleX(-1)' : undefined }}
          />
        </div>
      </div>

      <p className="text-center text-sm text-muted" role="status">
        {where ? `Nato is in the ${where.name}, where you last worked. ` : ''}
        {activeRooms.length === 0
          ? 'No room has had a chat yet today.'
          : `Today you chatted in the ${activeRooms.map((r) => r.name).join(' and the ')}.`}{' '}
        Click a room to go in.
      </p>
    </div>
  )
}
