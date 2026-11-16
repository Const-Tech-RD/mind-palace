/**
 * The helpers that live in the rooms: what each one is doing right now, and
 * the short log of what just happened. Pure, so it can be tested without the app.
 */
export type AgentState = 'idle' | 'thinking' | 'searching' | 'writing' | 'done'

export const AGENT_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  searching: 'Searching the web…',
  writing: 'Writing…',
  done: 'Done'
}

export interface StreamingAnswer {
  text: string
  /** The web search in progress, if any. */
  searching: string | null
}

export interface RoomAgent {
  state: AgentState
  /** The chat the helper is busy with, or just finished. Null when idle. */
  chatId: string | null
  /** What the speech bubble says. Empty when idle. */
  bubble: string
}

/** Where a chat that has no room yet is being handled: the sorter's room. */
export const SORTING_ROOM = 'mailroom'

export function agentState(streaming: StreamingAnswer | undefined): AgentState {
  if (!streaming) return 'idle'
  if (streaming.searching !== null) return 'searching'
  return streaming.text.trim() === '' ? 'thinking' : 'writing'
}

/**
 * The end of an answer in progress, as plain text short enough for a speech
 * bubble: markdown marks removed, cut at a word, with "…" in front when cut.
 */
export function bubbleTail(text: string, max = 90): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' (code) ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= max) return plain
  const tail = plain.slice(plain.length - max)
  const space = tail.indexOf(' ')
  return `…${space >= 0 && space < max / 2 ? tail.slice(space + 1) : tail}`
}

const BUSY_ORDER: Record<AgentState, number> = { writing: 0, searching: 1, thinking: 2, done: 3, idle: 4 }

/**
 * One helper per room. A helper is busy when a chat filed in its room is being
 * answered; a chat with no room yet, or a room the palace does not have, is
 * handled in the sorting room. With several at once the one furthest along
 * shows. `finished` maps a room to the chat whose answer just ended there.
 */
export function roomAgents(
  chats: ReadonlyArray<{ id: string; roomId: string | null }>,
  streaming: Readonly<Record<string, StreamingAnswer>>,
  roomIds: readonly string[],
  finished: Readonly<Record<string, string>> = {}
): Record<string, RoomAgent> {
  const agents: Record<string, RoomAgent> = {}
  for (const roomId of roomIds) {
    const chatId = finished[roomId]
    agents[roomId] = chatId ? { state: 'done', chatId, bubble: 'Done' } : { state: 'idle', chatId: null, bubble: '' }
  }
  const roomOf = new Map(chats.map((c) => [c.id, c.roomId]))
  for (const [chatId, answer] of Object.entries(streaming)) {
    const filed = roomOf.get(chatId) ?? null
    const roomId = filed !== null && roomIds.includes(filed) ? filed : SORTING_ROOM
    const current = agents[roomId]
    if (!current) continue
    const state = agentState(answer)
    if (BUSY_ORDER[state] >= BUSY_ORDER[current.state]) continue
    const bubble =
      state === 'searching' ? `Searching: ${answer.searching}` : state === 'writing' ? bubbleTail(answer.text) : AGENT_LABEL.thinking
    agents[roomId] = { state, chatId, bubble }
  }
  return agents
}

export type ActivityKind = 'asked' | 'searching' | 'answered' | 'stopped' | 'filed' | 'project' | 'error'

export interface ActivityItem {
  id: number
  at: string
  kind: ActivityKind
  text: string
  chatId: string | null
  roomId: string | null
}

export const ACTIVITY_LIMIT = 20

/** Newest first, capped. A repeat of the newest entry (same kind, chat and text) is dropped. */
export function addActivity(log: readonly ActivityItem[], item: Omit<ActivityItem, 'id'>): ActivityItem[] {
  const newest = log[0]
  if (newest && newest.kind === item.kind && newest.chatId === item.chatId && newest.text === item.text) return [...log]
  return [{ ...item, id: (newest?.id ?? 0) + 1 }, ...log].slice(0, ACTIVITY_LIMIT)
}

/** What changed for a chat between two readings of the chat list, as activity lines. */
export function chatChanges(
  before: { roomId: string | null; project: { title: string } | null; suggestion: { title: string } | null } | undefined,
  after: { title: string; roomId: string | null; roomSource: 'model' | 'user' | null; project: { title: string } | null; suggestion: { title: string } | null } | undefined,
  roomName: (roomId: string) => string | undefined
): Array<{ kind: ActivityKind; text: string; movedTo?: string }> {
  if (!after) return []
  const changes: Array<{ kind: ActivityKind; text: string; movedTo?: string }> = []
  const title = after.title || 'New chat'
  if (after.roomId !== null && after.roomId !== (before?.roomId ?? null)) {
    const name = roomName(after.roomId)
    if (name) {
      changes.push({
        kind: 'filed',
        text: after.roomSource === 'user' ? `You moved “${title}” to the ${name}` : `“${title}” was filed in the ${name}`,
        movedTo: after.roomId
      })
    }
  }
  if (after.project && after.project.title !== before?.project?.title) {
    changes.push({ kind: 'project', text: `“${title}” is now part of the project ${after.project.title}` })
  } else if (after.suggestion && after.suggestion.title !== before?.suggestion?.title) {
    changes.push({ kind: 'project', text: `“${title}” looks like a project: ${after.suggestion.title}` })
  }
  return changes
}

/** "just now", "3 min ago", "2 h ago", then the day. */
export function ago(at: string, now: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  return at.slice(0, 10)
}
