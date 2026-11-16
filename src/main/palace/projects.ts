import { localDayOf } from '@shared/engine'
import { applyProjectAction, type ProjectAction, type ProjectSummary } from '@shared/projects'
import type { PalaceRepo } from './repo'

export interface ProjectServiceDeps {
  repo: PalaceRepo
  /** The rooms that exist now; rooms are made while the app runs. */
  roomIds: () => readonly string[]
  /** IANA timezone used for the one-completion-per-day rule. */
  timeZone: () => string
  onChanged: (chatId: string) => void
  /** Called after a project action succeeds (the reminders service listens). */
  afterAction?: (projectId: string, action: ProjectAction) => void
  /** Called when a linked chat gets a new message. */
  afterActivity?: (projectId: string) => void
  /** Runs before a chat changes room, so the room it leaves keeps what it earned. */
  beforeMove?: () => void
  /** After a goal is reopened in a room (its kept goal mark goes back down). */
  afterReopen?: (roomId: string) => void
  now?: () => Date
}

export function createProjectService(deps: ProjectServiceDeps) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())

  /** Removes a suggestion's project if it was only ever a suggestion made for this chat. */
  function discardIfOnlySuggested(projectId: string, chatId: string): void {
    const project = repo.project(projectId)
    if (project?.state === 'suggested' && repo.originChatOf(projectId) === chatId) repo.deleteProject(projectId)
  }

  return {
    /** Tracked projects only: a suggestion is not a project until the user says "Track". */
    list(): ProjectSummary[] {
      return repo.projects().filter((project) => project.state !== 'suggested')
    },

    /** "Track": the suggested project becomes active, or the chat joins the project it was recognised as. */
    track(chatId: string): { projectId: string } {
      const chat = repo.chat(chatId)
      if (!chat) throw new Error('That chat no longer exists.')
      const projectId = chat.suggestedProjectId
      const project = projectId ? repo.project(projectId) : undefined
      if (!projectId || !project) {
        if (projectId) repo.setSuggestion(chatId, null)
        throw new Error('There is no project suggestion for this chat any more.')
      }
      const at = now().toISOString()
      repo.transaction(() => {
        repo.linkChat(projectId, chatId)
        repo.updateProject(projectId, {
          ...(project.state === 'suggested' ? { state: 'active' as const } : {}),
          lastActivityAt: chat.lastMessageAt ?? at
        })
        repo.setSuggestion(chatId, null)
      })
      deps.onChanged(chatId)
      return { projectId }
    },

    /** "Just a question": drop the suggestion and never offer this chat again. */
    dismiss(chatId: string): void {
      const chat = repo.chat(chatId)
      if (!chat) return
      repo.transaction(() => {
        if (chat.suggestedProjectId) discardIfOnlySuggested(chat.suggestedProjectId, chatId)
        repo.dismissSuggestion(chatId, now().toISOString())
      })
      deps.onChanged(chatId)
    },

    /** Before a chat is deleted: a project that only existed as its suggestion goes with it. */
    forgetSuggestionOf(chatId: string): void {
      const chat = repo.chat(chatId)
      if (chat?.suggestedProjectId) discardIfOnlySuggested(chat.suggestedProjectId, chatId)
    },

    act(projectId: string, action: ProjectAction): ProjectSummary {
      const project = repo.project(projectId)
      if (!project) throw new Error('That project no longer exists.')
      const at = now()
      const change = applyProjectAction(project.state, action, at)
      repo.transaction(() => {
        repo.updateProject(projectId, {
          state: change.state,
          ...(change.closedAt !== undefined ? { closedAt: change.closedAt } : {}),
          ...(change.snoozedUntil !== undefined ? { snoozedUntil: change.snoozedUntil } : {})
        })
        if (change.completion === 'add') {
          const localDay = localDayOf(at, deps.timeZone())
          // Every completion is stored; the engine counts at most one per room per local day.
          repo.addCompletion({ projectId, roomId: project.roomId, localDay })
        } else if (change.completion === 'remove') {
          repo.removeCompletions(projectId)
        }
      })
      if (change.completion === 'remove') deps.afterReopen?.(project.roomId)
      deps.afterAction?.(projectId, action)
      return repo.project(projectId)!
    },

    /** "Move to room": the user's choice, which the classifier never overrides. */
    moveChat(chatId: string, roomId: string): void {
      if (!deps.roomIds().includes(roomId)) throw new Error(`There is no room "${roomId}".`)
      if (!repo.chat(chatId)) throw new Error('That chat no longer exists.')
      deps.beforeMove?.()
      repo.setRoom(chatId, roomId, 'user')
      deps.onChanged(chatId)
    },

    /** Activity = a new message in a linked chat. */
    noteActivity(chatId: string): void {
      for (const projectId of repo.touchProjectsOfChat(chatId, now().toISOString())) deps.afterActivity?.(projectId)
    }
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
