import { localDayOf, type LocalDay } from './days'
import type { RoomEvent } from './types'

/** The columns of `chats`, `messages` and `goal_completions` the engine needs. */
export interface ChatRow {
  id: string
  /** Null until classified; unclassified chats feed no room. */
  roomId: string | null
}

export interface MessageRow {
  chatId: string
  role: string
  /** UTC ISO-8601. */
  createdAt: string
}

export interface GoalCompletionRow {
  projectId: string
  roomId: string
  /** Stored at completion time, in the timezone that was set then. */
  localDay: LocalDay
}

export interface HistoryRows {
  chats: readonly ChatRow[]
  messages: readonly MessageRow[]
  goalCompletions: readonly GoalCompletionRow[]
}

/**
 * Turns database rows into engine events. Pure.
 *
 * - Only user messages make a room day, and they count for the room the chat
 *   is in *now*, so moving a chat moves its whole history.
 * - Message days are derived from the UTC timestamp with the given timezone,
 *   so changing the timezone setting re-buckets every message.
 * - Goal completions keep the local day stored on their row.
 * - The stored `counted` flag is deliberately not read: the engine counts
 *   distinct days itself, which stays right after a reopen (see NOTES.md).
 */
export function buildRoomEvents(rows: HistoryRows, timeZone: string): RoomEvent[] {
  const roomOfChat = new Map<string, string>()
  for (const chat of rows.chats) if (chat.roomId !== null) roomOfChat.set(chat.id, chat.roomId)

  const events: RoomEvent[] = []
  for (const message of rows.messages) {
    if (message.role !== 'user') continue
    const roomId = roomOfChat.get(message.chatId)
    if (roomId === undefined) continue
    events.push({
      kind: 'user_message',
      roomId,
      localDay: localDayOf(message.createdAt, timeZone),
      chatId: message.chatId
    })
  }
  for (const completion of rows.goalCompletions) {
    events.push({
      kind: 'goal_completed',
      roomId: completion.roomId,
      localDay: completion.localDay,
      projectId: completion.projectId
    })
  }
  return events
}

/** Reopening a done project deletes its completion: the same history without it. */
export function reopenGoal(events: readonly RoomEvent[], projectId: string): RoomEvent[] {
  return events.filter((e) => !(e.kind === 'goal_completed' && e.projectId === projectId))
}
