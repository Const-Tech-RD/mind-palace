/**
 * The command bar's search: one flat list of things to jump to, filtered and
 * ranked by what was typed. Pure, so it can be tested without the app.
 */
export type CommandTarget =
  | { type: 'new-chat' }
  | { type: 'palace' }
  | { type: 'projects' }
  | { type: 'reminders' }
  | { type: 'room'; roomId: string }
  | { type: 'chat-in'; roomId: string }
  | { type: 'chat'; chatId: string }

export interface Command {
  id: string
  kind: 'action' | 'room' | 'chat' | 'project'
  title: string
  /** Shown beside the title: where it is or what it does. */
  hint: string
  target: CommandTarget
}

export interface CommandData {
  rooms: ReadonlyArray<{ id: string; name: string }>
  chats: ReadonlyArray<{ id: string; title: string; roomId: string | null; lastMessageAt: string | null; createdAt: string }>
  projects: ReadonlyArray<{ id: string; title: string; roomId: string; state: string; chatIds: readonly string[] }>
}

/** Lower case, without accents, so "cancion" finds "canción". */
export const normalise = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const KIND_ORDER: Record<Command['kind'], number> = { action: 0, room: 1, project: 2, chat: 3 }
/** With nothing typed, only this many recent chats are offered. */
const RECENT_CHATS = 5

/** Every command there is, chats most recent first. */
export function allCommands(data: CommandData): Command[] {
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name]))
  const commands: Command[] = [
    { id: 'new-chat', kind: 'action', title: 'New chat', hint: 'Ask anything', target: { type: 'new-chat' } },
    { id: 'palace', kind: 'action', title: 'Palace', hint: 'All rooms', target: { type: 'palace' } },
    { id: 'projects', kind: 'action', title: 'Projects', hint: 'Everything you are tracking', target: { type: 'projects' } },
    { id: 'reminders', kind: 'action', title: 'Reminders', hint: 'What is waiting for you', target: { type: 'reminders' } }
  ]
  for (const room of data.rooms) {
    commands.push({ id: `room:${room.id}`, kind: 'room', title: room.name, hint: 'Go to room', target: { type: 'room', roomId: room.id } })
    commands.push({
      id: `chat-in:${room.id}`,
      kind: 'room',
      title: `New chat in the ${room.name}`,
      hint: 'Filed there',
      target: { type: 'chat-in', roomId: room.id }
    })
  }
  for (const project of data.projects) {
    if (project.state !== 'active' && project.state !== 'paused') continue
    const chatId = project.chatIds[0]
    commands.push({
      id: `project:${project.id}`,
      kind: 'project',
      title: project.title,
      hint: `${project.state === 'paused' ? 'Paused project' : 'Project'} · ${roomName.get(project.roomId) ?? 'No room'}`,
      target: chatId ? { type: 'chat', chatId } : { type: 'projects' }
    })
  }
  const chats = [...data.chats].sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
  for (const chat of chats) {
    commands.push({
      id: `chat:${chat.id}`,
      kind: 'chat',
      title: chat.title || 'New chat',
      hint: chat.roomId ? (roomName.get(chat.roomId) ?? 'Unsorted') : 'Unsorted',
      target: { type: 'chat', chatId: chat.id }
    })
  }
  return commands
}

/** How well a title answers one typed word: 3 starts the title, 2 starts a word, 1 is inside one, 0 is absent. */
function wordScore(title: string, word: string): number {
  const at = title.indexOf(word)
  if (at < 0) return 0
  if (at === 0) return 3
  return /[^a-z0-9]/.test(title[at - 1]!) ? 2 : 1
}

/**
 * The commands that match, best first. Every typed word must appear in the
 * title or the hint; titles count for more. With nothing typed: the actions,
 * the rooms and the most recent chats.
 */
export function searchCommands(query: string, data: CommandData, limit = 12): Command[] {
  const commands = allCommands(data)
  const words = normalise(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    let chats = 0
    return commands
      .filter((c) => (c.kind === 'chat' ? chats++ < RECENT_CHATS : c.kind !== 'project' && c.target.type !== 'chat-in'))
      .slice(0, limit)
  }
  const scored: Array<{ command: Command; score: number; index: number }> = []
  commands.forEach((command, index) => {
    const title = normalise(command.title)
    const hint = normalise(command.hint)
    let score = 0
    for (const word of words) {
      const inTitle = wordScore(title, word)
      if (inTitle === 0 && !hint.includes(word)) return
      score += inTitle * 2 + (inTitle === 0 ? 1 : 0)
    }
    scored.push({ command, score, index })
  })
  return scored
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.command.kind] - KIND_ORDER[b.command.kind] || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.command)
}
