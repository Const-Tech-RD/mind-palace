import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Milestone, Proposal, SweepCandidate } from '@shared/milestones'
import { useStore } from '../store'

const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
/** A `YYYY-MM-DD` day, shown in the viewer's format (read at noon UTC so no timezone moves it a day). */
const showDay = (day: string): string => dayFormat.format(new Date(`${day}T12:00:00Z`))

const button = 'rounded-md px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50'
const quiet = `${button} bg-paper/10 text-paper hover:bg-paper/20`
const strong = `${button} bg-gold font-medium text-ink hover:bg-brass-light`
const icon = 'rounded px-1.5 text-xs text-paper/70 hover:bg-paper/10 hover:text-paper disabled:opacity-30'

function Evidence({ m }: { m: Pick<Milestone, 'evidence' | 'evidenceRef'> }) {
  if (m.evidence === 'commit' || m.evidence === 'plan') {
    return (
      <span title={`${m.evidence === 'commit' ? 'Commit' : 'Plan'} ${m.evidenceRef ?? ''}`} className="shrink-0 rounded-full bg-brass/25 px-2 py-0.5 text-[11px] text-brass-light">
        confirmed
      </span>
    )
  }
  if (m.evidence === 'chat') return <span className="shrink-0 rounded-full bg-paper/10 px-2 py-0.5 text-[11px] text-muted">from chats</span>
  return null
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper/10" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-full rounded-full bg-gold" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </div>
      <span className="shrink-0 text-sm font-medium">
        {done} of {total}
      </span>
    </div>
  )
}

function MilestoneRow({ projectId, m, index, count, disabled }: { projectId: string; m: Milestone; index: number; count: number; disabled: boolean }) {
  const edit = useStore((s) => s.editMilestone)
  const [renaming, setRenaming] = useState<string | null>(null)

  const save = (): void => {
    const title = renaming?.trim()
    setRenaming(null)
    if (title && title !== m.title) void edit(projectId, { kind: 'rename', id: m.id, title })
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setRenaming(null)
  }

  return (
    <li className="flex items-center gap-2 py-1.5" data-milestone={m.title}>
      <input
        type="checkbox"
        checked={m.status === 'done'}
        disabled={disabled}
        aria-label={`${m.title}: ${m.status === 'done' ? 'done' : 'planned'}`}
        onChange={(e) => void edit(projectId, { kind: 'tick', id: m.id, done: e.target.checked })}
        className="size-4 shrink-0 accent-gold"
      />
      {renaming !== null ? (
        <input
          autoFocus
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={onKey}
          onBlur={save}
          aria-label="Milestone title"
          className="min-w-0 flex-1 rounded bg-ink px-2 py-0.5 text-sm text-paper outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setRenaming(m.title)}
          title="Rename"
          className={`min-w-0 flex-1 truncate text-left text-sm ${m.status === 'done' ? 'text-paper/80' : 'text-paper'}`}
        >
          {m.title}
        </button>
      )}
      {m.doneOn && <span className="shrink-0 text-xs text-muted">{showDay(m.doneOn)}</span>}
      <Evidence m={m} />
      <span className="flex shrink-0">
        <button type="button" className={icon} disabled={disabled || index === 0} aria-label={`Move ${m.title} up`} onClick={() => void edit(projectId, { kind: 'move', id: m.id, toIndex: index - 1 })}>
          ↑
        </button>
        <button type="button" className={icon} disabled={disabled || index === count - 1} aria-label={`Move ${m.title} down`} onClick={() => void edit(projectId, { kind: 'move', id: m.id, toIndex: index + 1 })}>
          ↓
        </button>
        <button type="button" className={icon} disabled={disabled} aria-label={`Delete ${m.title}`} onClick={() => void edit(projectId, { kind: 'delete', id: m.id })}>
          ✕
        </button>
      </span>
    </li>
  )
}

function Proposals({ projectId, proposals, milestones, disabled }: { projectId: string; proposals: Proposal[]; milestones: Milestone[]; disabled: boolean }) {
  const answer = useStore((s) => s.answerProposal)
  const titleOf = (id: string | null): string => milestones.find((m) => m.id === id)?.title ?? ''
  return (
    <div className="rounded-md border border-brass/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-sm font-medium">Claude thinks these changed</p>
        <button type="button" className={quiet} disabled={disabled} onClick={() => void Promise.all(proposals.map((p) => answer(projectId, p.id, true)))}>
          Accept all
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {proposals.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm" data-proposal={p.title}>
            <span className="min-w-0 flex-1">
              {p.kind === 'tick' ? (
                <>
                  Done: <b>{titleOf(p.milestoneId) || p.title}</b>
                  {p.doneOn && <span className="text-muted"> · {showDay(p.doneOn)}</span>}
                </>
              ) : (
                <>
                  New milestone: <b>{p.title}</b>
                  {p.doneOn && <span className="text-muted"> · done {showDay(p.doneOn)}</span>}
                </>
              )}
            </span>
            <Evidence m={p} />
            <button type="button" className={strong} disabled={disabled} onClick={() => void answer(projectId, p.id, true)}>
              Accept
            </button>
            <button type="button" className={quiet} disabled={disabled} onClick={() => void answer(projectId, p.id, false)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SweepCard({ projectId, candidates }: { projectId: string; candidates: SweepCandidate[] }) {
  const link = useStore((s) => s.linkChats)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const toggle = (id: string): void =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const accept = candidates.filter((c) => !unticked.has(c.id)).map((c) => c.id)
  return (
    <div className="rounded-md border border-brass/30 p-3" data-sweep>
      <p className="text-sm font-medium">These chats look like part of this project</p>
      <p className="mb-2 text-xs text-muted">Untick any that aren't. Unticked chats are not offered again.</p>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-gold" checked={!unticked.has(c.id)} onChange={() => toggle(c.id)} />
              <span className="min-w-0">
                <span className="block truncate">{c.title}</span>
                {c.firstMessage && <span className="block truncate text-xs text-muted">{c.firstMessage}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className={`${strong} mt-3`} onClick={() => void link(projectId, accept, [...unticked])}>
        Link these
      </button>
    </div>
  )
}

/** A project's milestones and progress, under its card in the projects list. */
export function ProjectProgress({ projectId }: { projectId: string }) {
  const progress = useStore((s) => s.progress[projectId])
  const sweep = useStore((s) => s.sweeps[projectId])
  const busy = useStore((s) => s.progressBusy[projectId] ?? false)
  const error = useStore((s) => s.progressErrors[projectId])
  const load = useStore((s) => s.loadProgress)
  const sweepProject = useStore((s) => s.sweepProject)
  const refresh = useStore((s) => s.refreshProgress)
  const edit = useStore((s) => s.editMilestone)
  const setFolder = useStore((s) => s.setProjectFolder)
  const [adding, setAdding] = useState('')

  useEffect(() => {
    void load(projectId)
  }, [projectId, load])

  if (!progress) return <p className="mt-3 text-sm text-muted">Loading progress…</p>
  const working = busy || progress.running
  const first = progress.milestones.length === 0

  const add = (e: FormEvent): void => {
    e.preventDefault()
    const title = adding.trim()
    if (!title) return
    setAdding('')
    void edit(projectId, { kind: 'add', title, afterId: progress.milestones.at(-1)?.id ?? null })
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-brass/25 pt-3" data-progress={projectId}>
      {error && (
        <p role="alert" className="rounded-md bg-paper/10 px-3 py-2 text-sm text-paper">
          {error}
        </p>
      )}
      {working && <p className="text-sm text-muted">{busy ? 'Looking through your chats…' : 'Reading the chats and the repo…'}</p>}

      {sweep && sweep.length > 0 && <SweepCard projectId={projectId} candidates={sweep} />}

      {first && !sweep?.length ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-paper/90">No milestones yet. Claude can find this project's chats and lay out what's done and what's next.</p>
          <button type="button" className={strong} disabled={working} onClick={() => void sweepProject(projectId)}>
            Build progress
          </button>
        </div>
      ) : (
        !first && (
          <>
            {progress.progress && <ProgressBar done={progress.progress.done} total={progress.progress.total} />}
            {progress.proposals.length > 0 && <Proposals projectId={projectId} proposals={progress.proposals} milestones={progress.milestones} disabled={working} />}
            <ol className="flex flex-col divide-y divide-brass/15">
              {progress.milestones.map((m, i) => (
                <MilestoneRow key={m.id} projectId={projectId} m={m} index={i} count={progress.milestones.length} disabled={working} />
              ))}
            </ol>
            <form onSubmit={add} className="flex gap-2">
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder="Add milestone"
                aria-label="New milestone"
                className="min-w-0 flex-1 rounded-md bg-ink px-3 py-1 text-sm text-paper placeholder:text-muted outline-none"
              />
              <button type="submit" className={quiet} disabled={working || adding.trim() === ''}>
                Add
              </button>
            </form>
          </>
        )
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted" data-folder>
        <span className="min-w-0 truncate" title={progress.folder ?? undefined}>
          {progress.folder ? `Folder: ${progress.folder}` : 'No folder'}
        </span>
        {progress.folderProblem && <span className="text-paper/80">· {progress.folderProblem}</span>}
        <button type="button" className={icon} onClick={() => void setFolder(projectId, 'pick')}>
          Change
        </button>
        {progress.folder && (
          <button type="button" className={icon} onClick={() => void setFolder(projectId, null)}>
            Clear
          </button>
        )}
      </div>

      {!first && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quiet} disabled={working} onClick={() => void sweepProject(projectId)}>
            Find more chats
          </button>
          <button type="button" className={quiet} disabled={working} onClick={() => void refresh(projectId)}>
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}
