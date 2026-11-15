/**
 * Reminder rules: when a quiet project is due a nudge, how many notifications
 * a day may be shown, and the text asked of the model. Pure.
 */
import type { ProjectAction, ProjectState } from './projects'

/** Days after the last activity at which the first reminders are due. */
export const REMINDER_OFFSETS_DAYS = [3, 7, 14] as const
/** After the listed offsets, one reminder every this many days. */
export const REPEAT_DAYS = 14
export const DAILY_NOTIFICATION_CAP = 2
export const SCHEDULER_MINUTES = 15

const DAY_MS = 86_400_000

/** Days after the last activity at which reminder number `step` (0-based) is due: 3, 7, 14, 28, 42… */
export function offsetDays(step: number): number {
  const listed = REMINDER_OFFSETS_DAYS[step]
  if (listed !== undefined) return listed
  const last = REMINDER_OFFSETS_DAYS[REMINDER_OFFSETS_DAYS.length - 1]!
  return last + REPEAT_DAYS * (step - REMINDER_OFFSETS_DAYS.length + 1)
}

export interface ReminderProject {
  id: string
  state: ProjectState
  /** Null for a project that has had no message since it was tracked. */
  lastActivityAt: string | null
  createdAt: string
  snoozedUntil: string | null
  /** Reminders already accounted for since the last activity. */
  remindersSent: number
}

export interface DueReminder {
  projectId: string
  /** When this reminder came due (may be well before now if the machine was off). */
  dueAt: string
  /**
   * What `reminders_sent` becomes. Every cadence point already in the past is
   * counted as sent, so a project that was quiet for weeks while the machine
   * was off gets one reminder now, not one per missed point.
   */
  remindersSent: number
}

/**
 * The reminder a project is due, if any. Only active projects are reminded;
 * a snooze holds the reminder back until it ends.
 */
export function reminderDue(project: ReminderProject, now: Date): DueReminder | null {
  if (project.state !== 'active') return null
  const base = Date.parse(project.lastActivityAt ?? project.createdAt)
  if (Number.isNaN(base)) return null
  const snoozed = project.snoozedUntil ? Date.parse(project.snoozedUntil) : Number.NEGATIVE_INFINITY
  const due = Math.max(base + offsetDays(project.remindersSent) * DAY_MS, Number.isNaN(snoozed) ? Number.NEGATIVE_INFINITY : snoozed)
  if (due > now.getTime()) return null

  let sent = project.remindersSent + 1
  while (base + offsetDays(sent) * DAY_MS <= now.getTime()) sent++
  return { projectId: project.id, dueAt: new Date(due).toISOString(), remindersSent: sent }
}

export interface PlannedReminder extends DueReminder {
  /** False when today's notifications are used up or switched off: the reminder goes to the inbox only. */
  notify: boolean
}

/**
 * Everything due right now, longest-overdue first, with the daily cap applied:
 * at most `cap` notifications per local day across all projects.
 */
export function planReminders(input: {
  projects: readonly ReminderProject[]
  now: Date
  notifiedToday: number
  notificationsOn: boolean
  cap?: number
}): PlannedReminder[] {
  const cap = input.cap ?? DAILY_NOTIFICATION_CAP
  let left = input.notificationsOn ? Math.max(0, cap - input.notifiedToday) : 0
  return input.projects
    .map((project) => reminderDue(project, input.now))
    .filter((due): due is DueReminder => due !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.projectId.localeCompare(b.projectId))
    .map((due) => ({ ...due, notify: left-- > 0 }))
}

/** How a reminder ended. `ignored` = the next one came due with no reaction in between. */
export type ReminderOutcome = 'opened' | 'done' | 'snoozed' | 'paused' | 'dropped' | 'ignored'

/** The outcome a project action gives to that project's waiting reminder. */
export const OUTCOME_OF_ACTION: Record<ProjectAction, ReminderOutcome | null> = {
  done: 'done',
  snooze: 'snoozed',
  pause: 'paused',
  drop: 'dropped',
  reopen: null
}

/** What the inbox and the notification can do with a reminder. */
export type ReminderResponse = 'open' | 'done' | 'snooze' | 'pause' | 'drop'
export const REMINDER_RESPONSES: readonly ReminderResponse[] = ['open', 'done', 'snooze', 'pause', 'drop']

export const REMINDER_RESPONSE_LABEL: Record<ReminderResponse, string> = {
  open: 'Open',
  done: 'Done',
  snooze: 'Snooze 2 weeks',
  pause: 'Pause',
  drop: 'Drop'
}

/** A reminder waiting in the in-app inbox. */
export interface ReminderItem {
  id: string
  projectId: string
  projectTitle: string
  roomId: string
  message: string
  dueAt: string
  /** Whether a system notification was shown for it. */
  notified: boolean
  /** The project's most recent chat, to open. */
  chatId: string | null
}

export const NUDGE_SYSTEM_PROMPT = [
  'You write one short reminder for a personal project the person has not touched in a while.',
  'Name the project and give exactly one small, concrete next step they could do in a few minutes.',
  'Be warm and plain. No guilt, no pressure, no exclamation marks, no emoji, no questions.',
  'Write in the language the person used in the chat. At most 160 characters.'
].join(' ')

export const NUDGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } }
} as const

const MAX_NUDGE_CONTEXT_CHARS = 6000

export function buildNudgePrompt(input: {
  title: string
  nextStep: string | null
  messages: ReadonlyArray<{ role: string; content: string }>
}): string {
  // The end of the conversation says most about where things were left.
  let transcript = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n')
  if (transcript.length > MAX_NUDGE_CONTEXT_CHARS) transcript = `[…]\n${transcript.slice(-MAX_NUDGE_CONTEXT_CHARS)}`
  return [
    `Project: ${input.title}`,
    `Next step noted when it was tracked: ${input.nextStep ?? 'none'}`,
    '## Where the conversation was left',
    transcript || '(no messages)',
    '## Your answer',
    'message: the reminder text.'
  ].join('\n\n')
}

/** Used when the model cannot be reached: the reminder still goes out. */
export function fallbackNudge(title: string, nextStep: string | null): string {
  return nextStep ? `${title}: ${nextStep}` : `${title}: pick one small next step.`
}

export const MAX_NUDGE_LENGTH = 240

/** The model's text, trimmed to one line of sane length; null if unusable. */
export function cleanNudge(value: unknown): string | null {
  const message = typeof value === 'object' && value !== null ? (value as { message?: unknown }).message : undefined
  if (typeof message !== 'string') return null
  const text = message.replace(/\s+/g, ' ').trim()
  if (text === '') return null
  return text.length <= MAX_NUDGE_LENGTH ? text : `${text.slice(0, MAX_NUDGE_LENGTH - 1).trimEnd()}…`
}
