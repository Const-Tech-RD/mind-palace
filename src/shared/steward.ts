/**
 * The steward: the palace's voice assistant. A spoken or typed order goes to
 * the small model with a description of the palace as it stands; the model
 * answers with a short spoken reply and a list of actions inside the app.
 * Everything here is pure: the prompt, the reply's shape, and the checks that
 * decide what may run. The steward never acts outside the app.
 */
import type { ProjectAction } from './projects'
import type { ReminderResponse } from './reminders'

export type StewardLanguage = 'en' | 'es'

export type StewardAction =
  | { type: 'go_palace' }
  | { type: 'go_room'; roomId: string }
  | { type: 'show_projects' }
  | { type: 'show_reminders' }
  | { type: 'open_chat'; chatId: string }
  /** Starts a chat, in a room when given, and sends `message` when given. */
  | { type: 'new_chat'; roomId: string | null; message: string | null }
  | { type: 'move_chat'; chatId: string; roomId: string }
  | { type: 'delete_chat'; chatId: string }
  | { type: 'project_action'; projectId: string; action: ProjectAction }
  | { type: 'reminder_respond'; reminderId: string; response: ReminderResponse }
  | { type: 'music'; op: 'play' | 'pause' | 'mute' | 'unmute' | 'louder' | 'quieter' }

/** What the steward is told about the palace, so it can name real things by their ids. */
export interface StewardContext {
  /** Where the person is looking: the map, a room, a chat, or another screen. */
  where: string
  rooms: Array<{ id: string; name: string }>
  chats: Array<{ id: string; title: string; roomId: string | null }>
  projects: Array<{ id: string; title: string; roomId: string; state: string }>
  reminders: Array<{ id: string; projectTitle: string }>
  music: { chosen: boolean; playing: boolean }
}

export interface StewardReply {
  language: StewardLanguage
  /** What the steward says out loud: one or two short sentences. */
  say: string
  actions: StewardAction[]
}

const PROJECT_ACTIONS: readonly ProjectAction[] = ['done', 'snooze', 'pause', 'drop', 'reopen']
const REMINDER_RESPONSES: readonly ReminderResponse[] = ['open', 'done', 'snooze', 'pause', 'drop']
const MUSIC_OPS = ['play', 'pause', 'mute', 'unmute', 'louder', 'quieter'] as const

/** The shape the small model must answer in. Flat, because one action type has no field the others lack entirely. */
export const STEWARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['language', 'say', 'actions'],
  properties: {
    language: { type: 'string', enum: ['en', 'es'] },
    say: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: ['go_palace', 'go_room', 'show_projects', 'show_reminders', 'open_chat', 'new_chat', 'move_chat', 'delete_chat', 'project_action', 'reminder_respond', 'music']
          },
          roomId: { type: ['string', 'null'] },
          chatId: { type: 'string' },
          projectId: { type: 'string' },
          reminderId: { type: 'string' },
          message: { type: ['string', 'null'] },
          action: { type: 'string', enum: [...PROJECT_ACTIONS] },
          response: { type: 'string', enum: [...REMINDER_RESPONSES] },
          op: { type: 'string', enum: [...MUSIC_OPS] }
        }
      }
    }
  }
} as const

export const STEWARD_SYSTEM = [
  'You are the steward of a "mind palace": a desktop app where each chat with Claude is filed in a room, projects are tracked, and reminders wait for an answer.',
  'The person gives you an order by voice or by typing, in English or Spanish. The text may come from speech recognition, so forgive small mishearings and match names loosely.',
  'Answer in the SAME language as the order. Set "language" to "en" or "es" accordingly.',
  '"say" is spoken aloud: one or two short, plain sentences. No markdown, no lists, no emoji. Say what you did, or answer the question briefly, or ask what you need to know.',
  '"actions" are things you do inside the app, in order. Use only ids listed in the palace description. Use an empty list when nothing should be done.',
  'You can only act inside this app. You cannot touch files, run programs, browse, send messages or change anything outside it. If asked for that, say so in one sentence and do nothing.',
  'For a quick factual question, answer it in "say" with no action. For anything that needs real work, thought or length (writing, code, plans, research), use new_chat with the request as "message", in the room that fits, and say that the answer is being written.',
  'To start an empty chat use new_chat with message null. roomId null means "let the palace file it".',
  'Deleting a chat and dropping a project cannot be undone. You may propose them as actions; the app asks the person to confirm before it runs them, so say that you need a yes.',
  'Never invent an id. If you cannot tell which chat, project or room is meant, ask in "say" and do nothing.'
].join('\n')

const line = (label: string, items: string[]): string => `${label}:\n${items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)'}`

/** The order together with everything the steward may act on. */
export function buildStewardPrompt(order: string, context: StewardContext): string {
  const roomName = new Map(context.rooms.map((r) => [r.id, r.name]))
  return [
    `The person is looking at: ${context.where}`,
    line('Rooms', context.rooms.map((r) => `${r.name} (id ${r.id})`)),
    line('Projects', context.projects.map((p) => `"${p.title}" (id ${p.id}) in ${roomName.get(p.roomId) ?? p.roomId}, ${p.state}`)),
    line('Reminders waiting', context.reminders.map((r) => `about "${r.projectTitle}" (id ${r.id})`)),
    line('Recent chats', context.chats.map((c) => `"${c.title}" (id ${c.id})${c.roomId ? ` in ${roomName.get(c.roomId) ?? c.roomId}` : ', not filed yet'}`)),
    `Music: ${context.music.chosen ? (context.music.playing ? 'playing' : 'chosen, not playing') : 'no file chosen'}`,
    '',
    `The order: ${order.trim()}`
  ].join('\n')
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/**
 * One action as the model wrote it, checked against the palace: null when its
 * type is unknown, a field is missing, or it names something that is not there.
 */
export function checkAction(raw: unknown, context: StewardContext): StewardAction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  const room = (id: unknown): id is string => isString(id) && context.rooms.some((r) => r.id === id)
  const chat = (id: unknown): id is string => isString(id) && context.chats.some((c) => c.id === id)
  switch (a['type']) {
    case 'go_palace':
    case 'show_projects':
    case 'show_reminders':
      return { type: a['type'] }
    case 'go_room':
      return room(a['roomId']) ? { type: 'go_room', roomId: a['roomId'] } : null
    case 'open_chat':
      return chat(a['chatId']) ? { type: 'open_chat', chatId: a['chatId'] } : null
    case 'new_chat': {
      if (a['roomId'] != null && !room(a['roomId'])) return null
      return { type: 'new_chat', roomId: room(a['roomId']) ? a['roomId'] : null, message: isString(a['message']) ? a['message'].trim() : null }
    }
    case 'move_chat':
      return chat(a['chatId']) && room(a['roomId']) ? { type: 'move_chat', chatId: a['chatId'], roomId: a['roomId'] } : null
    case 'delete_chat':
      return chat(a['chatId']) ? { type: 'delete_chat', chatId: a['chatId'] } : null
    case 'project_action': {
      const known = isString(a['projectId']) && context.projects.some((p) => p.id === a['projectId'])
      const action = PROJECT_ACTIONS.find((x) => x === a['action'])
      return known && action ? { type: 'project_action', projectId: a['projectId'] as string, action } : null
    }
    case 'reminder_respond': {
      const known = isString(a['reminderId']) && context.reminders.some((r) => r.id === a['reminderId'])
      const response = REMINDER_RESPONSES.find((x) => x === a['response'])
      return known && response ? { type: 'reminder_respond', reminderId: a['reminderId'] as string, response } : null
    }
    case 'music': {
      const op = MUSIC_OPS.find((x) => x === a['op'])
      return op ? { type: 'music', op } : null
    }
    default:
      return null
  }
}

/** The model's answer made safe to use: unknown actions dropped, the language defaulted from the words. */
export function checkReply(raw: unknown, context: StewardContext): StewardReply {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const say = isString(r['say']) ? r['say'].trim() : ''
  const actions = Array.isArray(r['actions']) ? r['actions'].flatMap((a) => checkAction(a, context) ?? []) : []
  const language: StewardLanguage = r['language'] === 'es' || r['language'] === 'en' ? r['language'] : guessLanguage(say)
  return { language, say, actions }
}

/** What cannot be undone runs only after the person says yes. */
export function needsConfirmation(action: StewardAction): boolean {
  return action.type === 'delete_chat' || (action.type === 'project_action' && action.action === 'drop')
}

/** Splits a reply into what runs now and what waits for a yes. Order is kept within each part. */
export function splitActions(actions: readonly StewardAction[]): { now: StewardAction[]; held: StewardAction[] } {
  return { now: actions.filter((a) => !needsConfirmation(a)), held: actions.filter(needsConfirmation) }
}

const YES = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'confirm', 'confirmed', 'si', 'sí', 'claro', 'dale', 'hazlo', 'adelante', 'confirmo', 'correcto', 'de acuerdo']
const NO = ['no', 'nope', 'cancel', 'stop', "don't", 'do not', 'never mind', 'nevermind', 'cancela', 'cancelar', 'para', 'no lo hagas', 'mejor no', 'olvidalo', 'olvídalo', 'dejalo', 'déjalo']
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.,;:!?¡¿"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Whether what was said answers a pending "are you sure?". Only a short, plain
 * yes or no counts; anything longer is a new order, which cancels the pending one.
 */
export function confirmationAnswer(text: string): 'yes' | 'no' | null {
  const said = plain(text)
  if (said === '' || said.split(' ').length > 4) return null
  const has = (words: readonly string[]): boolean => words.some((w) => said === plain(w) || said.startsWith(`${plain(w)} `) || said.endsWith(` ${plain(w)}`))
  // "no" wins: "no, don't" must never be read as a yes.
  if (has(NO)) return 'no'
  if (has(YES)) return 'yes'
  return null
}

const SPANISH = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'por', 'para', 'con', 'es', 'está', 'esta', 'lo', 'al', 'se', 'no', 'sí', 'tu', 'mi', 'qué', 'cómo', 'ya', 'te', 'he', 'ha', 'hay', 'abre', 'abrir', 'cuarto', 'sala', 'música', 'proyecto', 'chat'])
const ENGLISH = new Set(['the', 'of', 'and', 'to', 'in', 'is', 'it', 'for', 'on', 'with', 'this', 'that', 'you', 'your', 'my', 'are', 'was', 'be', 'have', 'has', 'what', 'how', 'open', 'room', 'music', 'project', 'done', 'now', 'i', 'a'])

/** Spanish or English, from the words alone; English when it cannot tell. Used to pick the speaking voice. */
export function guessLanguage(text: string): StewardLanguage {
  if (/[¿¡ñáéíóú]/i.test(text)) return 'es'
  let es = 0
  let en = 0
  for (const word of plain(text).split(' ')) {
    if (SPANISH.has(word)) es++
    if (ENGLISH.has(word)) en++
  }
  return es > en ? 'es' : 'en'
}

/**
 * The start of a written answer, short enough to read aloud: markdown and
 * code removed, cut at the end of a sentence.
 */
export function spokenSummary(answer: string, max = 320): string {
  const text = answer
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[*_`>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}
