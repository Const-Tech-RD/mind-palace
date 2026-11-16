/** The projects list as compact rows (docs/mockups/project-card/compact.html); a row opens the project page. */
import { useEffect, useMemo, useState } from 'react'
import { localDayOf, type LocalDay } from '@shared/engine'
import { progressOf, type ProjectProgress } from '@shared/milestones'
import { nextMilestone, quietWeekdays, reviewItems, sortForList, statusOf, type ProjectStatus } from '@shared/projectPage'
import type { ProjectSummary } from '@shared/projects'
import { accentCss } from '../theme'
import { useStore } from '../store'
import { Bar, StatusPill } from './project/parts'

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** One project as a row: accent, title, status, progress, what's next and what's waiting for review. */
export function ProjectRow({
  title,
  accent,
  status,
  progress,
  nextTitle,
  toReview,
  quietNote,
  onOpen
}: {
  title: string
  accent: string
  status: ProjectStatus
  progress: { done: number; total: number } | null
  nextTitle: string | null
  toReview: number
  quietNote: string | null
  onOpen: () => void
}) {
  const quiet = status.kind === 'quiet' && status.weekdays > 0
  const held = status.kind === 'snoozed' || status.kind === 'paused'
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${title}`}
        className={`flex w-full flex-col gap-2.5 rounded-2xl border bg-ink-soft px-4.5 py-4 text-left hover:bg-raised/60 ${quiet ? 'border-gold-deep' : 'border-transparent'}`}
        data-project-row={title}
      >
        <span className="flex w-full items-center gap-2.5">
          <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="min-w-0 flex-1 truncate font-heading text-lg font-medium">{title}</span>
          <StatusPill status={status} small />
        </span>
        <span className="flex w-full">
          {progress ? <Bar done={progress.done} total={progress.total} label={`${progress.done} of ${progress.total} milestones done`} muted={held} /> : <span className="text-[13px] text-muted">No milestones yet</span>}
        </span>
        <span className="flex w-full justify-between gap-3 text-[13px] text-muted">
          <span className="min-w-0 truncate">{status.kind === 'snoozed' ? 'Not counted toward decay while snoozed' : nextTitle ? `Next: ${nextTitle}` : (quietNote ?? '')}</span>
          {toReview > 0 && <span className="shrink-0 whitespace-nowrap text-gold">{toReview} to review</span>}
        </span>
      </button>
    </li>
  )
}

export function ProjectsView() {
  const projects = useStore((s) => s.projects)
  const rooms = useStore((s) => s.status?.rooms)
  const progress = useStore((s) => s.progress)
  const appError = useStore((s) => s.appError)
  const loadProgress = useStore((s) => s.loadProgress)
  const showProject = useStore((s) => s.showProject)
  const [showHidden, setShowHidden] = useState(false)

  // Rows show each project's milestones: load the ones not loaded yet.
  useEffect(() => {
    for (const p of projects) if (!progress[p.id]) void loadProgress(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, loadProgress])

  const now = useMemo(() => new Date(), [projects])
  const today: LocalDay = localDayOf(now, zone)
  const rows = useMemo(() => {
    const listed = projects.map((p: ProjectSummary) => {
      const lastDay = p.lastActivityAt ? localDayOf(p.lastActivityAt, zone) : null
      const snoozed = p.snoozedUntil !== null && Date.parse(p.snoozedUntil) > now.getTime()
      return { ...p, quietWeekdays: p.state === 'active' ? quietWeekdays(lastDay, today) : 0, snoozed, lastDay }
    })
    return sortForList(listed)
  }, [projects, now, today])

  const row = (p: (typeof rows.shown)[number]) => {
    const pr: ProjectProgress | undefined = progress[p.id]
    const milestones = pr?.milestones ?? []
    const room = rooms?.find((r) => r.id === p.roomId)
    return (
      <ProjectRow
        key={p.id}
        title={p.title}
        accent={accentCss(room?.accent ?? 'mp-room-mailroom')}
        status={statusOf({ state: p.state, lastActivityDay: p.lastDay, snoozedUntil: p.snoozedUntil }, today, now)}
        progress={progressOf(milestones)}
        nextTitle={nextMilestone(milestones)?.title ?? null}
        toReview={reviewItems(milestones).length}
        quietNote={p.state === 'active' && p.lastDay === today ? 'Active today' : null}
        onOpen={() => void showProject(p.id)}
      />
    )
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-walnut">
      <header className="flex h-12 shrink-0 items-center border-b border-brass/25 px-5">
        <h1 className="text-sm font-medium">Projects</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[640px] flex-col gap-3.5 px-5 py-7">
          {appError && (
            <p role="alert" className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">
              {appError}
            </p>
          )}
          {projects.length === 0 ? (
            <p className="mt-24 text-center text-sm text-muted">No projects yet. When a chat looks like the start of one, it will offer to track it.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="m-0 font-heading text-[22px] font-medium">Projects</h2>
                <span className="text-[13px] text-muted">Quiet first</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-3.5 p-0">{rows.shown.map(row)}</ul>
              {rows.hidden.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showHidden}
                    onClick={() => setShowHidden((v) => !v)}
                    className="pp-line h-11 rounded-xl border border-dashed bg-transparent text-sm text-muted hover:text-paper"
                  >
                    {showHidden ? `Hide ${rows.hidden.length} done and paused` : `Show ${rows.hidden.length} done and paused`}
                  </button>
                  {showHidden && <ul className="m-0 flex list-none flex-col gap-3.5 p-0">{rows.hidden.map(row)}</ul>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
