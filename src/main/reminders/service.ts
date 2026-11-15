import { localDayOf } from '@shared/engine'
import type { ProjectAction } from '@shared/projects'
import {
  buildNudgePrompt,
  cleanNudge,
  fallbackNudge,
  NUDGE_JSON_SCHEMA,
  NUDGE_SYSTEM_PROMPT,
  OUTCOME_OF_ACTION,
  planReminders,
  type ReminderItem,
  type ReminderOutcome,
  type ReminderResponse
} from '@shared/reminders'
import type { JsonAnswer } from '../chat/claude'
import type { ReminderRepo } from './repo'

export interface ReminderServiceDeps {
  repo: ReminderRepo
  messagesOf: (chatId: string) => Array<{ role: string; content: string }>
  askModel: (prompt: string, system: string, schema: Record<string, unknown>) => Promise<JsonAnswer>
  /** Shows a system notification; returns false if it could not be shown. */
  notify: (item: ReminderItem) => boolean
  notificationsOn: () => boolean
  timeZone: () => string
  /** Carries out a project action (the projects service). */
  projectAct: (projectId: string, action: ProjectAction) => void
  /** The inbox changed. */
  onChanged: () => void
  now?: () => Date
  log?: (message: string) => void
}

export function createReminderService(deps: ReminderServiceDeps) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  let ticking = false

  /** Notifications already shown on the current local day. */
  function notifiedToday(at: Date): number {
    const today = localDayOf(at, deps.timeZone())
    // Two days back covers any timezone; the local-day comparison does the rest.
    const since = new Date(at.getTime() - 2 * 86_400_000).toISOString()
    return repo.notifiedSince(since).filter((sentAt) => localDayOf(sentAt, deps.timeZone()) === today).length
  }

  /** The reminder text: from the model over the project's chats, or a plain fallback. */
  async function nudgeFor(projectId: string): Promise<string | null> {
    const source = repo.nudgeSource(projectId)
    if (!source) return null
    const fallback = fallbackNudge(source.title, source.nextStep)
    try {
      const answer = await deps.askModel(
        buildNudgePrompt({
          title: source.title,
          nextStep: source.nextStep,
          messages: source.chatIds.flatMap((chatId) => deps.messagesOf(chatId))
        }),
        NUDGE_SYSTEM_PROMPT,
        NUDGE_JSON_SCHEMA
      )
      if (!answer.ok) {
        log(`nudge text for ${projectId} failed: ${answer.error}`)
        return fallback
      }
      return cleanNudge(answer.value) ?? fallback
    } catch (error) {
      log(`nudge text for ${projectId} failed: ${error instanceof Error ? error.message : String(error)}`)
      return fallback
    }
  }

  function resolve(projectId: string, outcome: ReminderOutcome): void {
    if (repo.resolve(projectId, outcome) > 0) deps.onChanged()
  }

  return {
    /**
     * One pass of the scheduler: creates a reminder for every project that is
     * due, and shows a notification for as many as today's cap allows.
     * Returns the number of reminders created.
     */
    async tick(): Promise<number> {
      if (ticking) return 0
      ticking = true
      let created = 0
      try {
        const at = now()
        const plan = planReminders({
          projects: repo.activeProjects(),
          now: at,
          notifiedToday: notifiedToday(at),
          notificationsOn: deps.notificationsOn()
        })
        for (const planned of plan) {
          const message = await nudgeFor(planned.projectId)
          if (message === null) continue // the project was deleted meanwhile
          // No reaction to the earlier reminder before this one came due.
          repo.resolve(planned.projectId, 'ignored')
          const id = repo.create({
            projectId: planned.projectId,
            dueAt: planned.dueAt,
            message,
            remindersSent: planned.remindersSent
          })
          created++
          if (planned.notify) {
            const item = repo.item(id)
            if (item && deps.notify(item)) repo.markNotified(id, now().toISOString())
          }
        }
        if (created > 0) deps.onChanged()
        return created
      } finally {
        ticking = false
      }
    },

    list: (): ReminderItem[] => repo.waiting(),

    /** A reaction to a reminder, from the inbox or from the notification. */
    respond(reminderId: string, response: ReminderResponse): { projectId: string; chatId: string | null } {
      const item = repo.item(reminderId)
      if (!item) throw new Error('That reminder has already been answered.')
      if (response === 'open') resolve(item.projectId, 'opened')
      else deps.projectAct(item.projectId, response) // comes back through `afterProjectAction`
      return { projectId: item.projectId, chatId: item.chatId }
    },

    /** Hook for the projects service: an action on a project answers its waiting reminder. */
    afterProjectAction(projectId: string, action: ProjectAction): void {
      const outcome = OUTCOME_OF_ACTION[action]
      if (outcome) resolve(projectId, outcome)
    },

    /** Hook for new chat activity in a project: the person came back on their own. */
    afterProjectActivity(projectId: string): void {
      resolve(projectId, 'opened')
    }
  }
}

export type ReminderService = ReturnType<typeof createReminderService>
