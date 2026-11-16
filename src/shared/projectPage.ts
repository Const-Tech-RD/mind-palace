/**
 * What the project page and the compact project rows show that isn't stored:
 * how quiet a project is and when its room dims, its status pill, its pace,
 * and how the list is sorted. Pure; `today` and `now` are always passed in.
 *
 * Quiet weekdays and dimming reuse the engine's own rules (`weekdaysBetween`,
 * `DECAY_THRESHOLDS`, `decayLevel`), so the page says exactly what the room does.
 */
import { addDays, DECAY_THRESHOLDS, weekdayIndex, dayNumber, weekdaysBetween, type LocalDay } from './engine'
import type { Milestone } from './milestones'
import type { ProjectState } from './projects'

/** Monday-to-Friday days since the last activity (0 with none). */
export function quietWeekdays(lastActivityDay: LocalDay | null, today: LocalDay): number {
  return lastActivityDay === null ? 0 : weekdaysBetween(lastActivityDay, today)
}

export interface DimOutlook {
  quiet: number
  /** Quiet weekdays at which the room starts to dim. */
  threshold: number
  /** Weekdays left before it dims (0 once dimming). */
  weekdaysLeft: number
  /** The day it starts to dim if nothing happens; null once dimming. */
  dimsOn: LocalDay | null
  dimming: boolean
}

const isWeekday = (day: LocalDay): boolean => {
  const w = weekdayIndex(dayNumber(day))
  return w >= 1 && w <= 5
}

/** When the project's room starts to dim if nothing happens. Null for a project with no activity yet. */
export function dimOutlook(lastActivityDay: LocalDay | null, today: LocalDay): DimOutlook | null {
  if (lastActivityDay === null) return null
  const quiet = quietWeekdays(lastActivityDay, today)
  const threshold = DECAY_THRESHOLDS[0]
  if (quiet >= threshold) return { quiet, threshold, weekdaysLeft: 0, dimsOn: null, dimming: true }
  const weekdaysLeft = threshold - quiet
  let day = today
  for (let left = weekdaysLeft; left > 0; ) {
    day = addDays(day, 1)
    if (isWeekday(day)) left -= 1
  }
  return { quiet, threshold, weekdaysLeft, dimsOn: day, dimming: false }
}

export type ProjectStatus =
  | { kind: 'active_today' }
  | { kind: 'quiet'; weekdays: number }
  | { kind: 'snoozed'; until: string }
  | { kind: 'paused' }
  | { kind: 'done' }
  | { kind: 'dropped' }

/** The status pill: paused, done and dropped by state; a running snooze; active today; otherwise quiet weekdays. */
export function statusOf(
  project: { state: ProjectState; lastActivityDay: LocalDay | null; snoozedUntil: string | null },
  today: LocalDay,
  now: Date
): ProjectStatus {
  if (project.state === 'paused') return { kind: 'paused' }
  if (project.state === 'done') return { kind: 'done' }
  if (project.state === 'dropped') return { kind: 'dropped' }
  if (project.snoozedUntil && Date.parse(project.snoozedUntil) > now.getTime()) return { kind: 'snoozed', until: project.snoozedUntil }
  if (project.lastActivityDay === today) return { kind: 'active_today' }
  return { kind: 'quiet', weekdays: quietWeekdays(project.lastActivityDay, today) }
}

const live = (list: Milestone[]): Milestone[] => list.filter((m) => m.deletedAt === null).sort((a, b) => a.position - b.position)

/** Done milestones per day, every day from `start` to `today` (days with none included). */
export function milestonesPerDay(list: Milestone[], start: LocalDay, today: LocalDay): Array<{ day: LocalDay; count: number }> {
  const counts = new Map<LocalDay, number>()
  for (const m of live(list)) if (m.status === 'done' && m.doneOn) counts.set(m.doneOn, (counts.get(m.doneOn) ?? 0) + 1)
  const out: Array<{ day: LocalDay; count: number }> = []
  for (let day = start; dayNumber(day) <= dayNumber(today); day = addDays(day, 1)) out.push({ day, count: counts.get(day) ?? 0 })
  return out
}

/** Fewer dated done milestones than this and the pace isn't shown: too little to go on. */
export const PACE_MIN_POINTS = 3

export interface Pace {
  done: number
  activeDays: number
  perActiveDay: number
  remaining: number
  /** Remaining milestones ÷ milestones per active day, rounded up. */
  activeDaysNeeded: number
}

export function paceEstimate(list: Milestone[]): Pace | null {
  const milestones = live(list)
  const dated = milestones.filter((m) => m.status === 'done' && m.doneOn !== null)
  if (dated.length < PACE_MIN_POINTS) return null
  const activeDays = new Set(dated.map((m) => m.doneOn)).size
  const perActiveDay = dated.length / activeDays
  const remaining = milestones.filter((m) => m.status === 'planned').length
  return { done: dated.length, activeDays, perActiveDay, remaining, activeDaysNeeded: Math.ceil(remaining / perActiveDay) }
}

/** Done milestones only the chats back, which the person hasn't touched: shown for review. */
export function reviewItems(list: Milestone[]): Milestone[] {
  return live(list).filter((m) => m.status === 'done' && m.evidence === 'chat' && !m.edited)
}

/** The first open milestone. */
export function nextMilestone(list: Milestone[]): Milestone | null {
  return live(list).find((m) => m.status === 'planned') ?? null
}

/** The done milestones outside the review, and the days they span. */
export function doneRange(list: Milestone[]): { count: number; from: LocalDay | null; to: LocalDay | null } {
  const inReview = new Set(reviewItems(list).map((m) => m.id))
  const done = live(list).filter((m) => m.status === 'done' && !inReview.has(m.id))
  const days = done.flatMap((m) => (m.doneOn ? [m.doneOn] : [])).sort()
  return { count: done.length, from: days[0] ?? null, to: days.at(-1) ?? null }
}

export interface ListProject {
  id: string
  title: string
  state: ProjectState
  quietWeekdays: number
  snoozed: boolean
}

const HIDDEN_ORDER: Partial<Record<ProjectState, number>> = { paused: 0, done: 1, dropped: 2 }

/** Open projects, quietest first and snoozed ones last; paused, done and dropped ones go behind "Show N". */
export function sortForList<T extends ListProject>(projects: T[]): { shown: T[]; hidden: T[] } {
  const shown = projects
    .filter((p) => HIDDEN_ORDER[p.state] === undefined)
    .sort((a, b) => Number(a.snoozed) - Number(b.snoozed) || b.quietWeekdays - a.quietWeekdays || a.title.localeCompare(b.title))
  const hidden = projects
    .filter((p) => HIDDEN_ORDER[p.state] !== undefined)
    .sort((a, b) => HIDDEN_ORDER[a.state]! - HIDDEN_ORDER[b.state]! || a.title.localeCompare(b.title))
  return { shown, hidden }
}
