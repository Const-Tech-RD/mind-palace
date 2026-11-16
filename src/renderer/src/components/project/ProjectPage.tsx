/** The expanded project page (docs/mockups/project-card/main.html). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { localDayOf, type LocalDay } from '@shared/engine'
import { progressOf } from '@shared/milestones'
import { dimOutlook, doneRange, milestonesPerDay, nextMilestone, paceEstimate, reviewItems, statusOf } from '@shared/projectPage'
import { nextReminderAt } from '@shared/reminders'
import { accentCss } from '../../theme'
import { useStore } from '../../store'
import { AddMilestone, Bar, dimLine, DoneSection, Momentum, ReminderCard, ReviewBanner, RoomCard, showDay, Sources, StatusPill, Suggestions, TodoList, UpNext } from './parts'

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
const dayOf = (iso: string | null): LocalDay | null => (iso ? localDayOf(iso, zone) : null)

function MoreMenu({ onPause, onDone, onDrop, canPause }: { onPause: () => void; onDone: () => void; onDrop: () => void; canPause: boolean }) {
  const [open, setOpen] = useState(false)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDrop(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = 'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] hover:bg-paper/10'
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="More actions: pause, mark done, drop"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setConfirmDrop(false)
        }}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="pp-line flex size-11 items-center justify-center rounded-xl border text-paper hover:bg-paper/5"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-20 w-60 rounded-xl border border-raised bg-ink-soft p-1.5 shadow-lg" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {confirmDrop ? (
            <div className="flex flex-col gap-2 p-2">
              <p className="m-0 text-sm">Drop this project? It leaves your active list; you can reopen it later.</p>
              <div className="flex gap-2">
                <button type="button" role="menuitem" autoFocus onClick={onDrop} className="h-11 flex-1 rounded-lg bg-danger/20 font-semibold text-danger">
                  Drop
                </button>
                <button type="button" role="menuitem" onClick={() => setConfirmDrop(false)} className="h-11 flex-1 rounded-lg hover:bg-paper/10">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {canPause && (
                <button type="button" role="menuitem" autoFocus className={item} onClick={onPause}>
                  Pause
                </button>
              )}
              <button type="button" role="menuitem" autoFocus={!canPause} className={item} onClick={onDone}>
                Mark done
              </button>
              <button type="button" role="menuitem" className={`${item} text-danger`} onClick={() => setConfirmDrop(true)}>
                Drop…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectPage() {
  const projectId = useStore((s) => s.projectPageId)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectPageId))
  const room = useStore((s) => s.status?.rooms.find((r) => r.id === project?.roomId))
  const progress = useStore((s) => (s.projectPageId ? s.progress[s.projectPageId] : undefined))
  const sweep = useStore((s) => (s.projectPageId ? s.sweeps[s.projectPageId] : undefined))
  const busy = useStore((s) => (s.projectPageId ? (s.progressBusy[s.projectPageId] ?? false) : false))
  const error = useStore((s) => (s.projectPageId ? s.progressErrors[s.projectPageId] : undefined)) ?? null
  const chats = useStore((s) => s.chats)
  const git = useStore((s) => (s.projectPageId ? s.gitInfo[s.projectPageId] : undefined))
  const store = useStore.getState

  const [now] = useState(() => new Date())
  const today = useMemo(() => localDayOf(now, zone), [now])

  useEffect(() => {
    if (projectId) void store().loadGitInfo(projectId)
  }, [projectId, progress?.folder, store])

  if (!projectId || !project) return <section className="flex-1 p-8 text-sm text-muted">This project is gone.</section>

  const milestones = progress?.milestones ?? []
  const counts = progressOf(milestones)
  const review = reviewItems(milestones)
  const next = nextMilestone(milestones)
  const inReview = new Set(review.map((m) => m.id))
  const todo = milestones.filter((m) => m.status === 'planned')
  const done = milestones.filter((m) => m.status === 'done' && !inReview.has(m.id))
  const range = doneRange(milestones)
  const lastDay = dayOf(project.lastActivityAt)
  const status = statusOf({ state: project.state, lastActivityDay: lastDay, snoozedUntil: project.snoozedUntil }, today, now)
  const outlook = project.state === 'active' ? dimOutlook(lastDay, today) : null
  const firstDone = milestones.flatMap((m) => (m.doneOn ? [m.doneOn] : [])).sort()[0]
  const createdDay = dayOf(project.createdAt)!
  const started = firstDone && firstDone < createdDay ? firstDone : createdDay
  const lastChatId = project.chatIds[0] ?? null
  const lastChatDay = dayOf(chats.find((c) => c.id === lastChatId)?.lastMessageAt ?? null)
  const roomName = room?.name ?? 'Mail room'
  const working = busy || (progress?.running ?? false)

  const edit = (e: Parameters<ReturnType<typeof store>['editMilestone']>[1]): void => void store().editMilestone(projectId, e)
  const openLastChat = lastChatId ? () => void store().selectChat(lastChatId) : null
  const resume = (): void => (openLastChat ? openLastChat() : store().startChatIn(project.roomId))
  const startOnNext = (): void => store().startChatIn(project.roomId, next ? `Let's work on the next milestone of ${project.title}: ${next.title}.` : '')
  const act = (action: 'snooze' | 'pause' | 'done' | 'drop'): void => void store().projectAction(projectId, action)
  const moveTo = (id: string, targetId: string): void => {
    const toIndex = milestones.findIndex((m) => m.id === targetId)
    if (toIndex >= 0) edit({ kind: 'move', id, toIndex })
  }
  const gitLine = git ? [git.branch, git.lastCommit ? `${git.lastCommit.subject}, ${showDay(git.lastCommit.day)}` : null, `${git.uncommitted} uncommitted file${git.uncommitted === 1 ? '' : 's'}`].filter(Boolean).join(' · ') : null

  return (
    <section className="pp-page h-full min-w-0 flex-1 overflow-y-auto bg-walnut text-[15px] text-paper" aria-label={`Project: ${project.title}`}>
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 pt-8 pb-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-muted">
          <button type="button" className="min-h-11 hover:text-paper" onClick={() => void store().showPalace()}>
            Palace
          </button>
          <span aria-hidden="true">/</span>
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 hover:text-paper" onClick={() => void store().showPalace(project.roomId)}>
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentCss(room?.accent ?? 'mp-room-mailroom') }} />
            {roomName}
          </button>
          <span aria-hidden="true">/</span>
          <button type="button" className="min-h-11 hover:text-paper" onClick={() => void store().showProjects()}>
            Projects
          </button>
          <span aria-hidden="true">/</span>
          <span className="text-paper" aria-current="page">
            {project.title}
          </span>
        </nav>

        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-raised pb-6">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="m-0 font-heading text-[40px] leading-[1.1] font-medium">{project.title}</h1>
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted">
              <StatusPill status={status} />
              {dimLine(outlook, today) && <span>{dimLine(outlook, today)}</span>}
              {counts && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {counts.done} of {counts.total} milestones
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Started {showDay(started)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={resume} className="inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-[15px] font-bold text-ink hover:bg-brass-light">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M7 5l11 7-11 7z" />
              </svg>
              Resume
            </button>
            {project.state === 'active' && (
              <button type="button" onClick={() => act('snooze')} className="pp-line h-11 rounded-xl border px-4 text-[15px] hover:bg-paper/5">
                Snooze
              </button>
            )}
            <MoreMenu canPause={project.state === 'active'} onPause={() => act('pause')} onDone={() => act('done')} onDrop={() => act('drop')} />
          </div>
        </header>

        {error && (
          <p role="alert" className="m-0 rounded-xl bg-danger/15 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="pp-grid">
          <main className="flex min-w-0 flex-col gap-6">
            <UpNext
              milestone={next}
              index={next ? milestones.findIndex((m) => m.id === next.id) + 1 : 0}
              total={milestones.length}
              lastChatDay={lastChatDay}
              onStart={startOnNext}
              onOpenChat={openLastChat}
              onDone={() => next && edit({ kind: 'tick', id: next.id, done: true })}
            />

            <section aria-labelledby="pp-ms" className="flex flex-col gap-4 rounded-2xl bg-ink-soft px-6 py-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="pp-ms" className="m-0 font-heading text-xl font-medium">
                  Milestones
                </h2>
                <div className="flex max-w-[320px] flex-1 items-center gap-2">
                  {counts && <Bar done={counts.done} total={counts.total} label={`${counts.done} of ${counts.total} milestones done`} />}
                  <button
                    type="button"
                    aria-label="Check the chats and the repo for changes"
                    title="Check for changes"
                    disabled={working || milestones.length === 0}
                    onClick={() => void store().refreshProgress(projectId)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:text-paper disabled:opacity-40"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
                    </svg>
                  </button>
                </div>
              </div>

              {working && <p className="m-0 text-sm text-muted">{busy ? 'Looking through your chats…' : 'Reading the chats and the repo…'}</p>}

              {sweep && sweep.length > 0 && <SweepPick projectId={projectId} />}

              {milestones.length === 0 && !sweep?.length && (
                <div className="flex flex-col items-start gap-2">
                  <p className="m-0 text-sm text-paper/90">No milestones yet. Claude can find this project's chats and lay out what's done and what's next, or add your own below.</p>
                  <button type="button" disabled={working} onClick={() => void store().sweepProject(projectId)} className="h-11 rounded-xl bg-gold px-5 font-bold text-ink disabled:opacity-50">
                    Build progress
                  </button>
                </div>
              )}

              <Suggestions
                proposals={progress?.proposals ?? []}
                titleOf={(id) => milestones.find((m) => m.id === id)?.title ?? ''}
                disabled={working}
                onAnswer={(id, accept) => void store().answerProposal(projectId, id, accept)}
              />

              <ReviewBanner
                items={review}
                chatDayOf={(m) => (m.evidenceRef ? dayOf(chats.find((c) => c.id === m.evidenceRef)?.lastMessageAt ?? null) : null)}
                onConfirm={(id) => edit({ kind: 'confirm', id })}
                onReject={(id) => edit({ kind: 'delete', id })}
              />

              <div className="flex flex-col">
                {todo.length > 0 && <span className="pt-1 pb-2 text-xs font-bold tracking-[.08em] text-muted uppercase">To do · {todo.length}</span>}
                <TodoList
                  items={todo}
                  nextId={next?.id ?? null}
                  disabled={working}
                  onTick={(id) => edit({ kind: 'tick', id, done: true })}
                  onRemove={(id) => edit({ kind: 'delete', id })}
                  onMove={moveTo}
                  onRename={(id, title) => edit({ kind: 'rename', id, title })}
                />
                <AddMilestone disabled={working} onAdd={(title) => edit({ kind: 'add', title, afterId: todo.at(-1)?.id ?? milestones.at(-1)?.id ?? null })} />
              </div>

              <DoneSection items={done} from={range.from} to={range.to} />
            </section>
          </main>

          <aside className="flex min-w-0 flex-col gap-4">
            <Momentum days={milestonesPerDay(milestones, started, today)} pace={paceEstimate(milestones)} quietSince={status.kind === 'quiet' && status.weekdays > 0 ? lastDay : null} />
            <RoomCard name={roomName} outlook={outlook} counts={project.state === 'active'} />
            <Sources
              chatCount={project.chatIds.length}
              latestChatDay={lastChatDay}
              onOpenChat={openLastChat}
              onFindMore={() => void store().sweepProject(projectId)}
              folder={progress?.folder ?? null}
              gitLine={gitLine}
              folderProblem={progress?.folderProblem ?? null}
              onChangeFolder={() => void store().setProjectFolder(projectId, 'pick')}
              onClearFolder={() => void store().setProjectFolder(projectId, null)}
              busy={working}
            />
            <ReminderCard
              next={nextReminderAt({ id: project.id, state: project.state, lastActivityAt: project.lastActivityAt, createdAt: project.createdAt, snoozedUntil: project.snoozedUntil, remindersSent: project.remindersSent })}
              now={now}
              active={project.state === 'active'}
            />
          </aside>
        </div>
      </div>
    </section>
  )
}

/** The sweep's proposed chats, waiting for "Link these". */
function SweepPick({ projectId }: { projectId: string }) {
  const candidates = useStore((s) => s.sweeps[projectId] ?? [])
  const link = useStore((s) => s.linkChats)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  return (
    <div className="pp-banner flex flex-col gap-2 rounded-xl border p-3.5" data-sweep>
      <p className="m-0 text-sm font-semibold">These chats look like part of this project</p>
      <p className="m-0 text-xs text-muted">Untick any that aren't. Unticked chats are not offered again.</p>
      <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-[18px] shrink-0 accent-gold"
                checked={!unticked.has(c.id)}
                onChange={() =>
                  setUnticked((prev) => {
                    const next = new Set(prev)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              <span className="min-w-0">
                <span className="block truncate">{c.title}</span>
                {c.firstMessage && <span className="block truncate text-xs text-muted">{c.firstMessage}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="h-11 self-start rounded-xl bg-gold px-5 font-bold text-ink"
        onClick={() =>
          void link(
            projectId,
            candidates.filter((c) => !unticked.has(c.id)).map((c) => c.id),
            [...unticked]
          )
        }
      >
        Link these
      </button>
    </div>
  )
}
