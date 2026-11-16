/**
 * Which areas of life are ready to become rooms. Pure.
 *
 * An area is suggested once enough chats in the Mail room share it and no
 * room has been made for it. Dismissing one hides it until more chats arrive.
 * Nothing here makes a room: the person does that with Materialize.
 */

/** Mail-room chats with one area before it is suggested as a room. */
export const SUGGEST_AT = 3
/** More chats in a dismissed area before it is suggested again. */
export const RETURN_AFTER = 5

export interface SuggestChat {
  roomId: string | null
  area: string | null
  areaName: string | null
  lastMessageAt: string | null
}

export interface Suggestion {
  area: string
  /** The name most chats gave the area. */
  name: string
  chats: number
  lastAt: string | null
}

export function suggestRooms(
  chats: readonly SuggestChat[],
  roomAreas: readonly string[],
  dismissed: ReadonlyArray<{ area: string; dismissedCount: number }>,
  mailRoomId: string
): Suggestion[] {
  const groups = new Map<string, { names: Map<string, number>; chats: number; lastAt: string | null }>()
  for (const chat of chats) {
    if (chat.roomId !== mailRoomId || chat.area === null) continue
    const group = groups.get(chat.area) ?? { names: new Map<string, number>(), chats: 0, lastAt: null }
    const name = chat.areaName?.trim() || chat.area
    group.names.set(name, (group.names.get(name) ?? 0) + 1)
    group.chats += 1
    if (chat.lastMessageAt !== null && (group.lastAt === null || chat.lastMessageAt > group.lastAt)) group.lastAt = chat.lastMessageAt
    groups.set(chat.area, group)
  }
  const taken = new Set(roomAreas)
  const hidden = new Map(dismissed.map((d) => [d.area, d.dismissedCount]))
  const suggestions: Suggestion[] = []
  for (const [area, group] of groups) {
    if (taken.has(area) || group.chats < SUGGEST_AT) continue
    const at = hidden.get(area)
    if (at !== undefined && group.chats < at + RETURN_AFTER) continue
    const name = [...group.names].sort((a, b) => b[1] - a[1])[0]![0]
    suggestions.push({ area, name, chats: group.chats, lastAt: group.lastAt })
  }
  return suggestions.sort((a, b) => b.chats - a.chats || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}

/** The projects that go with a new room: more than half of their chats are in it now. */
export function projectsToMove(
  projects: ReadonlyArray<{ id: string; chatIds: readonly string[] }>,
  roomOfChat: (chatId: string) => string | null,
  roomId: string
): string[] {
  return projects
    .filter((p) => p.chatIds.length > 0 && p.chatIds.filter((c) => roomOfChat(c) === roomId).length * 2 > p.chatIds.length)
    .map((p) => p.id)
}
