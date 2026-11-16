/** Project types and the rules for moving a project between states. Pure. */

export type ProjectState = 'suggested' | 'active' | 'paused' | 'done' | 'dropped'
export type ProjectAction = 'done' | 'snooze' | 'pause' | 'drop' | 'reopen'

export const SNOOZE_DAYS = 14

export interface ProjectSummary {
  id: string
  title: string
  roomId: string
  state: ProjectState
  nextStep: string | null
  lastActivityAt: string | null
  snoozedUntil: string | null
  createdAt: string
  closedAt: string | null
  /** Reminders already counted since the last activity: where the reminder cadence stands. */
  remindersSent: number
  /** Chats linked to the project, most recent first. */
  chatIds: string[]
}

/** What the "Track it?" card in a chat is offering. */
export interface ProjectSuggestion {
  projectId: string
  title: string
  nextStep: string | null
  /** True when the classifier recognised an open project instead of proposing a new one. */
  existing: boolean
}

/** The actions the projects panel offers for each state, in display order. */
export const ACTIONS_BY_STATE: Record<ProjectState, readonly ProjectAction[]> = {
  suggested: [],
  active: ['done', 'snooze', 'pause', 'drop'],
  paused: ['reopen', 'done', 'drop'],
  done: ['reopen'],
  dropped: ['reopen']
}

export interface ProjectChange {
  state: ProjectState
  /** `undefined` = leave as is. */
  closedAt?: string | null
  snoozedUntil?: string | null
  /** Marking done writes a goal completion; reopening a done project removes it. */
  completion: 'add' | 'remove' | 'none'
}

/** The effect of an action on a project, or an error when the state does not allow it. */
export function applyProjectAction(state: ProjectState, action: ProjectAction, now: Date): ProjectChange {
  if (!ACTIONS_BY_STATE[state].includes(action)) {
    throw new Error(`A ${state} project cannot be ${action === 'snooze' ? 'snoozed' : `marked "${action}"`}.`)
  }
  const at = now.toISOString()
  switch (action) {
    case 'done':
      return { state: 'done', closedAt: at, snoozedUntil: null, completion: 'add' }
    case 'drop':
      return { state: 'dropped', closedAt: at, snoozedUntil: null, completion: 'none' }
    case 'pause':
      return { state: 'paused', snoozedUntil: null, completion: 'none' }
    case 'snooze':
      return {
        state: 'active',
        snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * 86_400_000).toISOString(),
        completion: 'none'
      }
    case 'reopen':
      return { state: 'active', closedAt: null, snoozedUntil: null, completion: state === 'done' ? 'remove' : 'none' }
  }
}

export const PROJECT_STATE_ORDER: readonly ProjectState[] = ['active', 'paused', 'done', 'dropped']

export const PROJECT_STATE_LABEL: Record<ProjectState, string> = {
  suggested: 'Suggested',
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  dropped: 'Dropped'
}

export const PROJECT_ACTION_LABEL: Record<ProjectAction, string> = {
  done: 'Done',
  snooze: 'Snooze 2 weeks',
  pause: 'Pause',
  drop: 'Drop',
  reopen: 'Reopen'
}
