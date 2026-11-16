/**
 * Earned stays earned: the high-water marks to store for each room. Pure.
 *
 * A room's unlocks are judged against its best streak and its goal count. Both
 * are derived from the chats and projects in the room now, so moving a chat out
 * would lower them; the marks in `room_progress` keep them from going down.
 */
import type { KeptProgress, RoomState } from './engine'

export type ProgressMark = { roomId: string } & KeptProgress

/** The marks that rose since `kept` was read, one row per room; nothing for rooms that did not gain. */
export function progressMarks(states: readonly RoomState[], kept: Readonly<Record<string, KeptProgress>>): ProgressMark[] {
  const marks: ProgressMark[] = []
  for (const state of states) {
    const before = kept[state.roomId] ?? { bestStreak: 0, goalCount: 0 }
    const bestStreak = Math.max(before.bestStreak, state.streak.best)
    const goalCount = Math.max(before.goalCount, state.goals.count)
    if (bestStreak > before.bestStreak || goalCount > before.goalCount) marks.push({ roomId: state.roomId, bestStreak, goalCount })
  }
  return marks
}

/**
 * The goal mark after a goal is reopened (a deliberate undo): it drops by the
 * goal days the reopen removed, never by days that left with a project moved
 * to another room, and never below what the rows give now.
 */
export function goalMarkAfterReopen(kept: number, removedDays: number, daysNow: number): number {
  return Math.max(daysNow, kept - removedDays)
}
