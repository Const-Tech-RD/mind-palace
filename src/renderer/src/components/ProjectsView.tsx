import { useMemo, useState } from 'react'
import { accentCss } from '../theme'
import {
  ACTIONS_BY_STATE,
  PROJECT_ACTION_LABEL,
  PROJECT_STATE_LABEL,
  PROJECT_STATE_ORDER,
  type ProjectSummary
} from '@shared/projects'
import { useStore } from '../store'
import { ProjectProgress } from './ProjectProgress'

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const day = (iso: string | null): string | null => (iso ? dateFormat.format(new Date(iso)) : null)

function ProjectCard({ project }: { project: ProjectSummary }) {
  const room = useStore((s) => s.status?.rooms.find((r) => r.id === project.roomId))
  const projectAction = useStore((s) => s.projectAction)
  const selectChat = useStore((s) => s.selectChat)
  const snoozed = project.snoozedUntil !== null && new Date(project.snoozedUntil) > new Date()
  const closed = project.state === 'done' || project.state === 'dropped'
  const [showProgress, setShowProgress] = useState(false)

  return (
    <li className="rounded-lg bg-ink-soft p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{project.title}</h3>
        {room && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-paper/10 px-2.5 py-0.5 text-xs">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentCss(room.accent) }} />
            {room.name}
          </span>
        )}
      </div>
      {project.nextStep && !closed && <p className="mt-1 text-sm text-paper/90">Next step: {project.nextStep}</p>}
      <p className="mt-1 text-xs text-muted">
        {[
          closed && project.closedAt ? `Closed ${day(project.closedAt)}` : null,
          !closed && project.lastActivityAt ? `Last activity ${day(project.lastActivityAt)}` : null,
          snoozed ? `Snoozed until ${day(project.snoozedUntil)}` : null,
          `${project.chatIds.length} chat${project.chatIds.length === 1 ? '' : 's'}`
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS_BY_STATE[project.state].map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => void projectAction(project.id, action)}
            className={`rounded-md px-3 py-1 text-sm ${
              action === 'done' || action === 'reopen'
                ? 'bg-gold font-medium text-ink hover:bg-brass-light'
                : 'bg-paper/10 text-paper hover:bg-paper/20'
            }`}
          >
            {PROJECT_ACTION_LABEL[action]}
          </button>
        ))}
        {project.chatIds[0] && (
          <button
            type="button"
            onClick={() => void selectChat(project.chatIds[0]!)}
            className="rounded-md px-3 py-1 text-sm text-paper/80 hover:bg-paper/10"
          >
            Open chat
          </button>
        )}
        <button
          type="button"
          aria-expanded={showProgress}
          onClick={() => setShowProgress((open) => !open)}
          className="rounded-md px-3 py-1 text-sm text-paper/80 hover:bg-paper/10"
        >
          {showProgress ? 'Hide progress' : 'Progress'}
        </button>
      </div>
      {showProgress && <ProjectProgress projectId={project.id} />}
    </li>
  )
}

export function ProjectsView() {
  const projects = useStore((s) => s.projects)
  const appError = useStore((s) => s.appError)

  const byState = useMemo(
    () =>
      PROJECT_STATE_ORDER.map((state) => ({ state, items: projects.filter((p) => p.state === state) })).filter(
        (group) => group.items.length > 0
      ),
    [projects]
  )

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-brass/25 px-5">
        <h1 className="text-sm font-medium">Projects</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          {appError && (
            <p role="alert" className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
              {appError}
            </p>
          )}
          {byState.length === 0 && (
            <p className="mt-24 text-center text-sm text-muted">
              No projects yet. When a chat looks like the start of one, it will offer to track it.
            </p>
          )}
          {byState.map(({ state, items }) => (
            <section key={state}>
              <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                {PROJECT_STATE_LABEL[state]} · {items.length}
              </h2>
              <ul className="flex flex-col gap-3">
                {items.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
