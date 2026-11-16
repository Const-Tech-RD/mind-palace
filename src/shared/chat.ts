/**
 * Chat types shared by the main process and the renderer, plus the small pure
 * helpers both sides (and the tests) use. No Electron, database or SDK imports.
 */
import type { ProjectSuggestion } from './projects'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatSummary {
  id: string
  title: string
  /** Null until the classifier has placed the chat. */
  roomId: string | null
  /** `user` when the chat was moved by hand; the classifier then leaves it alone. */
  roomSource: 'model' | 'user' | null
  createdAt: string
  lastMessageAt: string | null
  /** The project this chat is part of, if any. */
  project: { id: string; title: string } | null
  /** Present while the "Track it?" card is waiting for an answer. */
  suggestion: ProjectSuggestion | null
}

export interface Source {
  title: string
  url: string
}

export interface ChatMessage {
  id: string
  chatId: string
  role: ChatRole
  content: string
  createdAt: string
  /** Web pages the answer drew on; derived from the stored content, never stored separately. */
  sources: Source[]
}

/** Why the app cannot talk to Claude, when it cannot. */
export type AuthState =
  | { status: 'ok' }
  /** No Claude Code login was found on this machine. */
  | { status: 'missing' }
  /** A login exists but Claude rejected it (expired, wrong plan, on hold). */
  | { status: 'rejected'; detail: string }

/**
 * Pushed from the main process while an answer is being produced. Every event
 * names its chat, so a renderer showing another chat can ignore it.
 */
export type ChatEvent =
  | { type: 'started'; chatId: string; userMessage: ChatMessage }
  | { type: 'delta'; chatId: string; text: string }
  /** The model started a web search. */
  | { type: 'searching'; chatId: string; query: string }
  | { type: 'done'; chatId: string; message: ChatMessage; stopped: boolean }
  | { type: 'error'; chatId: string; message: string; auth?: AuthState }
  /** The chat's room, project or suggestion changed; re-read the lists. */
  | { type: 'updated'; chatId: string }

export const UNSORTED_GROUP = 'unsorted'

export interface ChatGroup {
  /** A room id from the catalog, or `UNSORTED_GROUP`. */
  id: string
  name: string
  accent: string
  chats: ChatSummary[]
}

/** First line of the first message, trimmed to a readable length. */
export function titleFromMessage(text: string, maxLength = 60): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (firstLine.length === 0) return 'New chat'
  if (firstLine.length <= maxLength) return firstLine
  const cut = firstLine.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL = /(?<![(\[<"'=])\bhttps?:\/\/[^\s<>)\]"']+/g

/**
 * The web pages an answer cites, in order of first appearance, one per URL.
 * Reads markdown links first, then bare URLs, from the answer text itself: the
 * web search tool tells the model to list its sources, so the text is the
 * record of what was actually cited.
 */
export function extractSources(text: string): Source[] {
  const seen = new Map<string, Source>()
  const add = (rawUrl: string, title?: string): void => {
    const url = rawUrl.replace(/[.,;:!?]+$/, '')
    if (seen.has(url)) return
    let host: string
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return
    }
    const cleanTitle = title?.trim()
    seen.set(url, { url, title: cleanTitle && cleanTitle !== url ? cleanTitle : host })
  }
  for (const match of text.matchAll(MARKDOWN_LINK)) add(match[2]!, match[1])
  for (const match of text.matchAll(BARE_URL)) add(match[0])
  return [...seen.values()]
}

const SOURCES_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*sources\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/

/**
 * Splits an answer into its prose and the pages it cites.
 *
 * The web search tool makes the model end with a "Sources:" list. Shown as is,
 * that list repeats what the app already displays as source chips, so a
 * trailing list of that shape is taken out of the body. Its entries come first
 * and keep their titles (page titles read better than inline link text).
 * Only a list at the very end, made of nothing but links, is removed.
 */
export function splitSources(text: string): { body: string; sources: Source[] } {
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end--

  let start = end
  while (start > 0) {
    const line = lines[start - 1]!
    if (line.trim() === '') {
      start--
      continue
    }
    if (!LIST_ITEM.test(line) || extractSources(line).length === 0) break
    start--
  }
  // `start` is now the first line of the trailing link list; a heading must sit right above it.
  let heading = start - 1
  while (heading >= 0 && lines[heading]!.trim() === '') heading--
  const listLines = lines.slice(start, end).filter((line) => line.trim() !== '')

  if (listLines.length === 0 || heading < 0 || !SOURCES_HEADING.test(lines[heading]!)) {
    return { body: text, sources: extractSources(text) }
  }
  const body = lines.slice(0, heading).join('\n').trimEnd()
  const listed = listLines.join('\n')
  return { body, sources: extractSources(`${listed}\n${body}`) }
}

/**
 * Chats grouped by room for the sidebar, newest first inside each group.
 * Rooms keep the order they are given in; rooms without chats are left out,
 * and chats with no room, or a room the catalog no longer has, go to "Unsorted".
 */
export function groupChatsByRoom(
  chats: ChatSummary[],
  rooms: Array<{ id: string; name: string; accent: string }>
): ChatGroup[] {
  const known = new Map(rooms.map((room) => [room.id, room]))
  const byGroup = new Map<string, ChatSummary[]>()
  for (const chat of chats) {
    const key = chat.roomId !== null && known.has(chat.roomId) ? chat.roomId : UNSORTED_GROUP
    const list = byGroup.get(key)
    if (list) list.push(chat)
    else byGroup.set(key, [chat])
  }
  const newestFirst = (a: ChatSummary, b: ChatSummary): number =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)

  const groups: ChatGroup[] = []
  const unsorted = byGroup.get(UNSORTED_GROUP)
  if (unsorted) {
    groups.push({ id: UNSORTED_GROUP, name: 'Unsorted', accent: 'mp-room-unsorted', chats: unsorted.sort(newestFirst) })
  }
  for (const room of rooms) {
    const list = byGroup.get(room.id)
    if (list) groups.push({ ...room, chats: list.sort(newestFirst) })
  }
  return groups
}
