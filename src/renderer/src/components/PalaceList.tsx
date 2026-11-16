import { decayText, trackProgress, type PalaceRoom } from '@shared/palace'
import { accentCss } from '../theme'

/**
 * The palace as a plain list: the same rooms, progress and decay as the
 * canvas, for screen readers and for anyone who turns off animation.
 */
export function PalaceList({
  rooms,
  projectTitle,
  onOpen
}: {
  rooms: readonly PalaceRoom[]
  projectTitle: (projectId: string | null) => string | null
  onOpen: (roomId: string) => void
}) {
  const roomIds = rooms.map((r) => r.id)
  return (
    <ul className="flex flex-col gap-2 p-4" aria-label="Rooms">
      {rooms.map((room) => {
        const decay = decayText(room.decay, projectTitle(room.decay.projectId))
        return (
          <li key={room.id} className="rounded-lg border border-brass/35 bg-ink-soft px-4 py-3">
            <RoomSummary room={room} decay={decay} roomIds={roomIds} />
            <button
              type="button"
              onClick={() => onOpen(room.id)}
              className="mt-2 rounded-full border border-brass/50 px-3 py-1 text-xs font-semibold hover:bg-raised"
            >
              Open the {room.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Name, both tracks and decay: used by the list and by the hover tooltip. */
export function RoomSummary({ room, decay, roomIds }: { room: PalaceRoom; decay: string | null; roomIds: readonly string[] }) {
  const streak = trackProgress(room.state, 'streak', roomIds)
  const goals = trackProgress(room.state, 'goals', roomIds)
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentCss(room.accent) }} aria-hidden="true" />
        {room.name}
      </p>
      <p className="text-muted">
        Streak {streak.value}
        {streak.target !== null ? ` of ${streak.target}` : ''} · {streak.caption}
      </p>
      <p className="text-muted">
        Finished projects {goals.value}
        {goals.target !== null ? ` of ${goals.target}` : ''} · {goals.caption}
      </p>
      {decay && <p className="text-paper">{decay}</p>}
    </div>
  )
}
