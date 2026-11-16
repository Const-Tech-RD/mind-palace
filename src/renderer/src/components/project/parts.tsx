/// <reference lib="dom" />
/**
 * The project page's pieces (docs/mockups/project-card/main.html), presentational:
 * plain props in, callbacks out, no store. ProjectPage.tsx wires them up.
 */
import { useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { addDays, type LocalDay } from '@shared/engine'
import type { Milestone, Proposal } from '@shared/milestones'
import type { DimOutlook, Pace, ProjectStatus } from '@shared/projectPage'

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayLongFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
/** A `YYYY-MM-DD` day, read at noon UTC so no timezone moves it. */
export const showDay = (day: LocalDay): string => dayFormat.format(new Date(`${day}T12:00:00Z`))
const showDayLong = (day: LocalDay): string => dayLongFormat.format(new Date(`${day}T12:00:00Z`))
const showInstant = (iso: string): string => dayFormat.format(new Date(iso))

const card = 'rounded-2xl bg-ink-soft'
const h2 = 'm-0 font-heading text-lg font-medium'
const outline = 'pp-line inline-flex h-11 items-center justify-center rounded-xl border bg-transparent px-4 text-[15px] text-paper hover:bg-paper/5 disabled:opacity-50'

// --- Status ---------------------------------------------------------------------

export function statusLabel(status: ProjectStatus): string {
  switch (status.kind) {
    case 'active_today':
      return 'Active today'
    case 'quiet':
      return status.weekdays === 0 ? 'Quiet since the weekend' : `Quiet ${status.weekdays} weekday${status.weekdays === 1 ? '' : 's'}`
    case 'snoozed':
      return `Snoozed to ${showInstant(status.until)}`
    case 'paused':
      return 'Paused'
    case 'done':
      return 'Done'
    case 'dropped':
      return 'Dropped'
  }
}

export function StatusPill({ status, small = false }: { status: ProjectStatus; small?: boolean }) {
  const quiet = status.kind === 'quiet' && status.weekdays > 0
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold ${small ? 'px-2.5 py-0.5 text-xs' : 'px-2.5 py-0.5 text-sm'} ${
        quiet ? 'pp-pill-quiet' : status.kind === 'active_today' ? 'bg-success/20 text-success' : 'pp-pill-soft'
      }`}
    >
      {quiet && !small && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 8v4l2 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      )}
      {statusLabel(status)}
    </span>
  )
}

/** "Room dims tomorrow if nothing happens", or the day, or that it is dimming. */
export function dimLine(outlook: DimOutlook | null, today: LocalDay): string | null {
  if (!outlook) return null
  if (outlook.dimming) return 'The room has started to dim'
  if (outlook.dimsOn === addDays(today, 1)) return 'Room dims tomorrow if nothing happens'
  return `Room dims ${showDayLong(outlook.dimsOn!)} if nothing happens`
}

// --- Progress bar ---------------------------------------------------------------

export function Bar({ done, total, label, muted = false }: { done: number; total: number; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-1 items-center gap-2.5">
      <div role="img" aria-label={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-walnut">
        <div className={`h-full ${muted ? 'bg-gold-deep' : 'bg-gold'}`} style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </div>
      <span className="font-mono text-[13px] text-muted">
        {done}/{total}
      </span>
    </div>
  )
}

// --- Up next --------------------------------------------------------------------

export function UpNext({
  milestone,
  index,
  total,
  lastChatDay,
  onStart,
  onOpenChat,
  onDone
}: {
  milestone: Milestone | null
  /** 1-based place of the milestone among all. */
  index: number
  total: number
  lastChatDay: LocalDay | null
  onStart: () => void
  onOpenChat: (() => void) | null
  onDone: () => void
}) {
  return (
    <section aria-labelledby="pp-next" className="flex flex-col gap-3.5 rounded-2xl bg-paper p-6 text-ink">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pp-next" className="m-0 text-xs font-bold tracking-[.08em] text-ink-muted uppercase">
          Up next
        </h2>
        {milestone && (
          <span className="text-[13px] text-ink-muted">
            {index} of {total}
          </span>
        )}
      </div>
      {milestone ? (
        <>
          <p className="m-0 font-heading text-[28px] leading-tight font-medium">{milestone.title}</p>
          <div className="flex flex-col gap-1.5 rounded-xl bg-paper-shade px-4 py-3.5">
            <span className="text-xs font-bold text-ink-muted">{lastChatDay ? `Where you left off · chat of ${showDay(lastChatDay)}` : 'Where you left off'}</span>
            {/* TODO(plan v2, phase 11 · Memory): a one-line summary of the last chat goes here once chat summaries reach the page. */}
            <p className="m-0 text-sm text-ink-muted italic">No summary yet.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* TODO(plan v2, phase 6 · Background sessions): start a real session in the project's folder. Until then it opens a chat with the milestone drafted. */}
            <button type="button" onClick={onStart} className="h-11 rounded-xl bg-ink px-4.5 text-sm font-bold text-paper hover:bg-ink/90">
              Start a session on this
            </button>
            {onOpenChat && (
              <button type="button" onClick={onOpenChat} className="pp-parchment-line h-11 rounded-xl border bg-transparent px-4 text-sm text-ink hover:bg-ink/5">
                Open last chat
              </button>
            )}
            <button type="button" onClick={onDone} className="pp-parchment-line h-11 rounded-xl border bg-transparent px-4 text-sm text-ink hover:bg-ink/5">
              Mark done
            </button>
          </div>
        </>
      ) : (
        <p className="m-0 text-sm text-ink-muted">Nothing open. Add a milestone below, or mark the project done.</p>
      )}
    </section>
  )
}

// --- Review banner --------------------------------------------------------------

/** Done milestones only the chats back, one banner each: Confirm keeps it, "Not a milestone" removes it. */
export function ReviewBanner({ items, chatDayOf, onConfirm, onReject }: { items: Milestone[]; chatDayOf: (m: Milestone) => LocalDay | null; onConfirm: (id: string) => void; onReject: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2" data-review>
      {items.map((m) => {
        const day = chatDayOf(m) ?? m.doneOn
        return (
          <div key={m.id} className="pp-banner flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3" data-review-item={m.title}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-gold">
              <path d="M4 5h16v11H8l-4 4z" />
            </svg>
            <div className="min-w-[200px] flex-1">
              <p className="m-0 font-semibold">{m.title}</p>
              <p className="m-0 text-[13px] text-muted">{day ? `Found in your chat of ${showDay(day)} and counted as done. Is it a milestone?` : 'Found in your chats and counted as done. Is it a milestone?'}</p>
            </div>
            <button type="button" onClick={() => onConfirm(m.id)} aria-label={`Confirm ${m.title}`} className="h-11 rounded-[10px] bg-raised px-3.5 text-sm text-paper hover:bg-raised/80">
              Confirm
            </button>
            <button type="button" onClick={() => onReject(m.id)} aria-label={`${m.title} is not a milestone`} className="h-11 rounded-[10px] bg-transparent px-3.5 text-sm text-muted hover:text-paper">
              Not a milestone
            </button>
          </div>
        )
      })}
    </div>
  )
}

// --- Open milestones ------------------------------------------------------------

export function TodoList({
  items,
  nextId,
  disabled,
  onTick,
  onRemove,
  onMove,
  onRename
}: {
  items: Milestone[]
  nextId: string | null
  disabled: boolean
  onTick: (id: string) => void
  onRemove: (id: string) => void
  /** Move `id` to sit where `targetId` is now. */
  onMove: (id: string, targetId: string) => void
  onRename: (id: string, title: string) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)

  const keyMove = (e: KeyboardEvent, i: number): void => {
    const target = e.key === 'ArrowUp' ? items[i - 1] : e.key === 'ArrowDown' ? items[i + 1] : undefined
    if (!target) return
    e.preventDefault()
    onMove(items[i]!.id, target.id)
  }
  const drop = (e: DragEvent, targetId: string): void => {
    e.preventDefault()
    if (dragging && dragging !== targetId) onMove(dragging, targetId)
    setDragging(null)
    setOver(null)
  }
  const saveRename = (): void => {
    if (renaming && renaming.title.trim()) onRename(renaming.id, renaming.title.trim())
    setRenaming(null)
  }

  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label="Open milestones">
      {items.map((m, i) => (
        <li
          key={m.id}
          className="pp-row flex items-center gap-3 border-t border-raised py-1.5 last:border-b"
          data-milestone={m.title}
          data-dragging={dragging === m.id ? '' : undefined}
          data-drop-target={over === m.id && dragging !== m.id ? '' : undefined}
          draggable={!disabled && renaming?.id !== m.id}
          onDragStart={(e) => {
            setDragging(m.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(m.id)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
          onDrop={(e) => drop(e, m.id)}
        >
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              checked={false}
              disabled={disabled}
              onChange={() => onTick(m.id)}
              aria-label={`Mark ${m.title} done`}
              className="size-[18px] accent-gold"
            />
          </label>
          {renaming?.id === m.id ? (
            <input
              autoFocus
              aria-label="Milestone title"
              value={renaming.title}
              onChange={(e) => setRenaming({ id: m.id, title: e.target.value })}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename()
                if (e.key === 'Escape') setRenaming(null)
              }}
              className="h-9 min-w-0 flex-1 rounded-lg bg-walnut px-2 text-[15px] text-paper outline-none"
            />
          ) : (
            <button type="button" disabled={disabled} onClick={() => setRenaming({ id: m.id, title: m.title })} title="Rename" className="min-h-11 min-w-0 flex-1 truncate text-left text-[15px]">
              {m.title}
            </button>
          )}
          {m.id === nextId && <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-xs text-gold">Next</span>}
          <span className="pp-tools flex shrink-0">
            <button
              type="button"
              disabled={disabled}
              aria-label={`Drag to reorder ${m.title}, or use the arrow keys`}
              onKeyDown={(e) => keyMove(e, i)}
              className="flex size-11 cursor-grab items-center justify-center text-muted hover:text-paper"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="6" r="1" />
                <circle cx="15" cy="6" r="1" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="9" cy="18" r="1" />
                <circle cx="15" cy="18" r="1" />
              </svg>
            </button>
            <button type="button" disabled={disabled} aria-label={`Remove ${m.title}`} onClick={() => onRemove(m.id)} className="flex size-11 items-center justify-center text-muted hover:text-paper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function AddMilestone({ disabled, onAdd }: { disabled: boolean; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!title.trim()) return
    onAdd(title.trim())
    setTitle('')
  }
  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <label htmlFor="pp-add" className="sr-only">
        Add a milestone
      </label>
      <input
        id="pp-add"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a milestone"
        className="h-11 min-w-0 flex-1 rounded-xl border border-raised bg-walnut px-3.5 text-sm text-paper outline-none placeholder:text-muted"
      />
      <button type="submit" disabled={disabled || !title.trim()} className={outline}>
        Add
      </button>
    </form>
  )
}

// --- Done -----------------------------------------------------------------------

/** Confirmed done milestones, collapsed into one line with the dates they span. */
export function DoneSection({ items, from, to }: { items: Milestone[]; from: LocalDay | null; to: LocalDay | null }) {
  if (items.length === 0) return null
  const range = from && to ? (from === to ? showDay(from) : `${showDay(from)} – ${showDay(to)}`) : null
  return (
    <details className="pp-done border-t border-raised pt-3" data-done>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2.5">
        <span className="text-xs font-bold tracking-[.08em] text-muted uppercase">Done · {items.length} confirmed</span>
        <span className="text-[13px] text-muted">{range ? `${range} · show all` : 'show all'}</span>
      </summary>
      <ol className="mt-3 mb-0 flex flex-col gap-1.5 pl-[18px] text-sm text-muted">
        {items.map((m) => (
          <li key={m.id}>
            {m.title}
            {m.doneOn ? ` · ${showDay(m.doneOn)}` : ''}
          </li>
        ))}
      </ol>
    </details>
  )
}

// --- Proposals from a refresh -----------------------------------------------------

export function Suggestions({ proposals, titleOf, disabled, onAnswer }: { proposals: Proposal[]; titleOf: (id: string | null) => string; disabled: boolean; onAnswer: (id: string, accept: boolean) => void }) {
  if (proposals.length === 0) return null
  return (
    <div className="pp-banner flex flex-col gap-2 rounded-xl border p-3.5" data-suggestions>
      <p className="m-0 text-sm font-semibold">Claude thinks these changed</p>
      {proposals.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm" data-proposal={p.title}>
          <span className="min-w-0 flex-1">
            {p.kind === 'tick' ? 'Done: ' : 'New milestone: '}
            <b>{p.kind === 'tick' ? titleOf(p.milestoneId) || p.title : p.title}</b>
            {p.doneOn && <span className="text-muted"> · {showDay(p.doneOn)}</span>}
          </span>
          <button type="button" disabled={disabled} onClick={() => onAnswer(p.id, true)} className="h-11 rounded-[10px] bg-gold px-3.5 font-semibold text-ink">
            Accept
          </button>
          <button type="button" disabled={disabled} onClick={() => onAnswer(p.id, false)} className="h-11 rounded-[10px] px-3.5 text-muted hover:text-paper">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}

// --- Sidebar --------------------------------------------------------------------

export function SideCard({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3 px-5 py-4.5`}>
      <h2 id={id} className={h2}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Momentum({ days, pace, quietSince }: { days: Array<{ day: LocalDay; count: number }>; pace: Pace | null; quietSince: LocalDay | null }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  const width = 300
  const step = days.length === 0 ? 0 : width / days.length
  const bar = Math.max(2, Math.min(14, step - 4))
  const total = days.reduce((n, d) => n + d.count, 0)
  const active = days.filter((d) => d.count > 0).length
  const summary = days.length === 0 ? '' : `Milestones per day, ${showDay(days[0]!.day)} to today: ${days.map((d) => d.count).join(', ')}`
  return (
    <SideCard id="pp-momentum" title="Momentum">
      {days.length > 0 && (
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} 92`} width="100%">
          {days.map((d, i) => {
            const h = d.count === 0 ? 4 : 8 + (d.count / max) * 48
            return <rect key={d.day} x={i * step + (step - bar) / 2} y={72 - h} width={bar} height={h} rx={d.count === 0 ? 2 : 3} className={d.count === 0 ? 'fill-raised' : 'fill-gold'} />
          })}
          <text x="2" y="88" fontSize="11" className="fill-muted">
            {showDay(days[0]!.day)}
          </text>
          <text x={width - 2} y="88" fontSize="11" textAnchor="end" className="fill-muted">
            Today
          </text>
        </svg>
      )}
      <p className="m-0 text-sm text-muted">
        {total === 0
          ? 'No milestones finished yet.'
          : `${total} milestone${total === 1 ? '' : 's'} on ${active} active day${active === 1 ? '' : 's'}${quietSince ? `, then quiet since ${showDay(quietSince)}` : ''}.`}
        {pace && pace.remaining > 0 && ` At that pace, the last ${pace.remaining} take about ${pace.activeDaysNeeded} more active day${pace.activeDaysNeeded === 1 ? '' : 's'}.`}
      </p>
    </SideCard>
  )
}

export function RoomCard({ name, outlook, counts }: { name: string; outlook: DimOutlook | null; counts: boolean }) {
  return (
    <SideCard id="pp-room" title={name}>
      <div className="flex items-center gap-3">
        {/* TODO(plan v2, phase 4 · catalog item names): show the next goal item's sprite and name here. */}
        <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-gold-deep bg-walnut text-[11px] text-gold-deep">
          item
        </div>
        <p className="m-0 text-sm text-muted">{counts ? `Finishing this counts as a goal for the ${name} and furnishes its next piece.` : `This project lives in the ${name}.`}</p>
      </div>
      {outlook && (
        <p className="pp-warm m-0 text-sm">
          {outlook.dimming
            ? `Quiet weekdays: ${outlook.quiet}. The room has started to dim.`
            : `Quiet weekdays: ${outlook.quiet} of ${outlook.threshold} before the room starts to dim.`}
        </p>
      )}
    </SideCard>
  )
}

export function Sources({
  chatCount,
  latestChatDay,
  onOpenChat,
  onFindMore,
  folder,
  gitLine,
  folderProblem,
  onChangeFolder,
  onClearFolder,
  busy
}: {
  chatCount: number
  latestChatDay: LocalDay | null
  onOpenChat: (() => void) | null
  onFindMore: () => void
  folder: string | null
  gitLine: string | null
  folderProblem: string | null
  onChangeFolder: () => void
  onClearFolder: () => void
  busy: boolean
}) {
  const link = 'inline-flex min-h-11 items-center text-brass-light underline-offset-2 hover:text-gold hover:underline disabled:opacity-50'
  return (
    <SideCard id="pp-sources" title="Sources">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-muted">Chats · {chatCount}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          {latestChatDay ? `Latest ${showDay(latestChatDay)}` : 'None linked yet'}
          {onOpenChat && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className={link} onClick={onOpenChat}>
                Open
              </button>
            </>
          )}
          <span aria-hidden="true">·</span>
          <button type="button" className={link} onClick={onFindMore} disabled={busy}>
            Find more
          </button>
        </span>
      </div>
      <div className="flex flex-col gap-1" data-folder>
        <span className="text-xs font-bold text-muted">Folder</span>
        {folder ? <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{folder}</span> : <span className="text-sm text-muted">No folder</span>}
        {gitLine && <span className="text-[13px] text-muted">{gitLine}</span>}
        {folderProblem && <span className="text-[13px] text-muted">{folderProblem}</span>}
        <span className="flex gap-3 text-sm">
          <button type="button" className={link} onClick={onChangeFolder}>
            Change
          </button>
          {folder && (
            <button type="button" className={link} onClick={onClearFolder}>
              Clear
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-muted">Sessions</span>
        {/* TODO(plan v2, phases 6 and 9-10 · sessions, run traces, cost ledger): list runs, tokens and checkpoints. */}
        <span className="text-sm text-muted">None yet. Runs, tokens and checkpoints show here once sessions exist.</span>
      </div>
    </SideCard>
  )
}

const nudgeFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ReminderCard({ next, now, active }: { next: string | null; now: Date; active: boolean }) {
  const overdue = next !== null && Date.parse(next) <= now.getTime()
  return (
    <SideCard id="pp-reminder" title="Reminder">
      <p className="m-0 text-sm">{!active || next === null ? 'No reminders while the project is not active.' : overdue ? 'A nudge is due now' : `Next nudge ${nudgeFormat.format(new Date(next))}`}</p>
      {active && <p className="m-0 text-[13px] text-muted">3, 7 and 14 days after the last activity, then every 2 weeks. Snooze holds it 2 weeks.</p>}
    </SideCard>
  )
}
