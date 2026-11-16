import { useEffect, useMemo, useRef } from 'react'
import { REMINDER_RESPONSES, REMINDER_RESPONSE_LABEL } from '@shared/reminders'
import { useStore } from '../store'
import { HOTSPOT_ACTION, type HotspotKind } from './roomHotspots'

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const MAX_ROWS = 8

/**
 * The parchment card that opens when a thing in a room is clicked: the list
 * that thing stands for, with the actions that can be taken right there.
 * `roomId` is null for a panel that is about the whole palace (reminders).
 */
export function RoomPanel({
  kind,
  roomId,
  thing,
  left,
  top,
  onClose
}: {
  kind: Exclude<HotspotKind, 'chat' | 'exit'>
  roomId: string | null
  thing: string
  /** Where on the stage the card is pinned, in CSS pixels. */
  left: number
  top: number
  onClose: () => void
}) {
  const chats = useStore((s) => s.chats)
  const projects = useStore((s) => s.projects)
  const reminders = useStore((s) => s.reminders)
  const rooms = useStore((s) => s.status?.rooms)
  const selectChat = useStore((s) => s.selectChat)
  const projectAction = useStore((s) => s.projectAction)
  const respond = useStore((s) => s.respondToReminder)
  const moveChat = useStore((s) => s.moveChat)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    card.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    // Capture, so Esc closes the card before it leaves the room.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const roomName = (id: string): string => rooms?.find((r) => r.id === id)?.name ?? id
  const rows = useMemo(() => {
    const newest = <T extends { lastMessageAt?: string | null; createdAt: string }>(a: T, b: T): number =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
    if (kind === 'projects') return projects.filter((p) => p.roomId === roomId && p.state === 'active')
    if (kind === 'finished') return projects.filter((p) => p.roomId === roomId && p.state === 'done').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
    if (kind === 'chats') return chats.filter((c) => c.roomId === roomId).sort(newest)
    if (kind === 'unsorted') return chats.filter((c) => c.roomId === null).sort(newest)
    return reminders
  }, [kind, roomId, projects, chats, reminders])

  const empty: Record<typeof kind, string> = {
    projects: 'No project in progress in this room.',
    finished: 'Nothing finished here yet. Mark a project done and it lands here.',
    chats: 'No chat has been filed here yet.',
    unsorted: 'Nothing is waiting. Every chat has a room.',
    reminders: 'No reminder is waiting.'
  }
  const quiet = 'rounded-md border border-gold-deep/40 px-2 py-0.5 text-xs text-ink hover:bg-paper-shade'
  const primary = 'rounded-md bg-gold-deep px-2 py-0.5 text-xs font-semibold text-paper hover:bg-ink'

  return (
    <div
      ref={card}
      tabIndex={-1}
      role="dialog"
      aria-label={`${thing}: ${HOTSPOT_ACTION[kind]}`}
      data-testid="room-panel"
      className="room-panel absolute z-20 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-brass bg-paper p-3 text-ink shadow-[0_4px_14px_rgba(0,0,0,0.35)] outline-none"
      // Pinned by the thing that was clicked, but never off the stage.
      style={{ left: `min(${Math.round(left)}px, calc(100% - 18.75rem))`, top: `min(${Math.round(top)}px, calc(100% - 15rem))` }}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{HOTSPOT_ACTION[kind]}</h3>
        <span className="shrink-0 text-xs text-ink-muted">{rows.length}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 shrink-0 rounded px-1.5 text-lg leading-none text-ink-muted hover:bg-paper-shade">
          ×
        </button>
      </div>
      <p className="text-xs text-ink-muted">{thing}</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{empty[kind]}</p>
      ) : (
        <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {kind === 'reminders' &&
            reminders.slice(0, MAX_ROWS).map((item) => (
              <li key={item.id} className="rounded-lg bg-paper-shade p-2">
                <p className="truncate text-sm font-semibold" title={item.projectTitle}>
                  {item.projectTitle}
                </p>
                <p className="text-xs text-ink-muted">{roomName(item.roomId)}</p>
                <p className="mt-1 text-xs leading-snug">{item.message}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {REMINDER_RESPONSES.map((response) => (
                    <button
                      key={response}
                      type="button"
                      onClick={() => void respond(item.id, response)}
                      aria-label={`${REMINDER_RESPONSE_LABEL[response]}: ${item.projectTitle}`}
                      className={response === 'open' ? primary : quiet}
                    >
                      {REMINDER_RESPONSE_LABEL[response]}
                    </button>
                  ))}
                </div>
              </li>
            ))}

          {(kind === 'projects' || kind === 'finished') &&
            projects
              .filter((p) => rows.includes(p as never))
              .slice(0, MAX_ROWS)
              .map((project) => (
                <li key={project.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-paper-shade">
                  <button
                    type="button"
                    onClick={() => project.chatIds[0] && void selectChat(project.chatIds[0])}
                    disabled={!project.chatIds[0]}
                    className="min-w-0 flex-1 text-left"
                    title={project.title}
                  >
                    <span className="block truncate text-sm font-semibold">{project.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {kind === 'finished'
                        ? project.closedAt
                          ? `Finished ${dateFormat.format(new Date(project.closedAt))}`
                          : 'Finished'
                        : (project.nextStep ?? 'No next step written')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void projectAction(project.id, kind === 'finished' ? 'reopen' : 'done')}
                    aria-label={`${kind === 'finished' ? 'Reopen' : 'Mark done'}: ${project.title}`}
                    className={kind === 'finished' ? quiet : primary}
                  >
                    {kind === 'finished' ? 'Reopen' : 'Done'}
                  </button>
                </li>
              ))}

          {(kind === 'chats' || kind === 'unsorted') &&
            chats
              .filter((c) => rows.includes(c as never))
              .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
              .slice(0, MAX_ROWS)
              .map((chat) => (
                <li key={chat.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-paper-shade">
                  <button type="button" onClick={() => void selectChat(chat.id)} className="min-w-0 flex-1 truncate text-left text-sm" title={chat.title}>
                    {chat.title || 'New chat'}
                  </button>
                  {kind === 'unsorted' && roomId && (
                    <button type="button" onClick={() => void moveChat(chat.id, roomId)} aria-label={`Keep here: ${chat.title || 'New chat'}`} className={quiet}>
                      Keep here
                    </button>
                  )}
                </li>
              ))}
        </ul>
      )}
      {rows.length > MAX_ROWS && <p className="mt-2 text-xs text-ink-muted">and {rows.length - MAX_ROWS} more</p>}
    </div>
  )
}
