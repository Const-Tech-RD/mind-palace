/**
 * Room classification: the prompt, the shape of the model's answer, and the
 * rules for what to do with it. Pure; the model call lives in src/main/chat/claude.ts.
 */
import { z } from 'zod'

export const CONFIDENCE_THRESHOLD = 0.6
/** How long a chat must be quiet before it is classified once more. */
export const QUIET_MINUTES = 30

export interface ClassifierRoom {
  id: string
  name: string
  belongs: string
  not_here: string
  examples: string[]
}

export interface OpenProject {
  id: string
  title: string
  roomId: string
}

/** An area of life already named, by its key and how the model first put it. */
export interface KnownArea {
  key: string
  name: string
}

/**
 * One key for every spelling of an area: lower case, runs of anything but
 * letters and digits become `_`, no `_` at either end. "3D printing",
 * "3d-printing" and " 3D Printing " are all `3d_printing`.
 */
export function areaKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export interface ClassifierMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** What the model is asked to return. */
export const classificationSchema = z.object({
  room_id: z.string(),
  confidence: z.number().min(0).max(1),
  is_project: z.boolean(),
  project_title: z.string().nullable(),
  next_step: z.string().nullable(),
  /** Id of an open project this chat continues, when it clearly does. */
  existing_project_id: z.string().nullable(),
  /** The area of life the chat is about: a known area's key, or a new short one. */
  area: z.string(),
  area_name: z.string()
})
export type RawClassification = z.infer<typeof classificationSchema>

/** JSON Schema for the same shape, as the SDK's structured output wants it. */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['room_id', 'confidence', 'is_project', 'project_title', 'next_step', 'existing_project_id', 'area', 'area_name'],
  properties: {
    room_id: { type: 'string' },
    confidence: { type: 'number' },
    is_project: { type: 'boolean' },
    project_title: { type: ['string', 'null'] },
    next_step: { type: ['string', 'null'] },
    existing_project_id: { type: ['string', 'null'] },
    area: { type: 'string' },
    area_name: { type: 'string' }
  }
} as const

export const CLASSIFIER_SYSTEM_PROMPT = [
  'You sort chats from a personal chat app into rooms, name the area of life each chat is about, and spot chats that are the start of a project.',
  'You are given the rooms and the chat so far. Answer with the JSON object only.',
  'A project is something the person intends to build, make, plan or finish over more than one sitting (an app, a song, a logo, a trip plan). A single question, a lookup or a piece of advice is not a project.',
  'Be conservative about projects: a wrong project suggestion is more annoying than a missed one.'
].join(' ')

const MAX_MESSAGE_CHARS = 2000
const clip = (text: string): string =>
  text.length <= MAX_MESSAGE_CHARS ? text : `${text.slice(0, MAX_MESSAGE_CHARS)} […]`

/**
 * The classifier prompt, built from the catalog text so that editing a room's
 * `belongs`, `not_here` or `examples` changes the classifier without code.
 */
export function buildClassifierPrompt(input: {
  rooms: ClassifierRoom[]
  fallbackRoomId: string
  messages: ClassifierMessage[]
  openProjects: OpenProject[]
  /** Areas already named, so the model reuses them instead of coining near-duplicates. */
  knownAreas?: KnownArea[]
}): string {
  const rooms = input.rooms
    .map((room) => {
      const lines = [`### ${room.id} — ${room.name}`, `Belongs here: ${room.belongs}`]
      if (room.not_here.trim()) lines.push(`Not here: ${room.not_here}`)
      lines.push('Examples:', ...room.examples.map((example) => `- ${example}`))
      return lines.join('\n')
    })
    .join('\n\n')

  const projects =
    input.openProjects.length === 0
      ? 'None.'
      : input.openProjects.map((p) => `- id "${p.id}" · room ${p.roomId} · ${p.title}`).join('\n')

  const areas =
    (input.knownAreas ?? []).length === 0 ? 'None yet.' : (input.knownAreas ?? []).map((a) => `- ${a.key} — ${a.name}`).join('\n')

  const chat = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${clip(m.content)}`)
    .join('\n\n')

  return [
    '## Rooms',
    rooms,
    '## Open projects',
    projects,
    '## Known areas',
    areas,
    '## Chat so far',
    chat,
    '## Your answer',
    [
      `- room_id: the id of the one room this chat belongs in. If no room clearly fits, use "${input.fallbackRoomId}".`,
      '- confidence: 0 to 1, how sure you are of the room.',
      '- is_project: true only if this chat is the start or continuation of a project as defined above.',
      '- project_title: a short name for the project (3 to 6 words), or null when is_project is false.',
      '- next_step: one small concrete next step for the project, or null when is_project is false.',
      '- existing_project_id: the id of an open project from the list that this chat clearly continues, otherwise null. Never invent an id.',
      '- area: the area of life this chat is about, broad like a part of someone\'s life (software, finance, 3D printing, cooking, health), not a single project or tool. Building an app, a site, a script or any tool is software, whatever the app is about. Reuse the key of a known area whenever it fits; only coin a new short key when none does.',
      '- area_name: how to call that area in 1 to 3 words ("3D printing"); for a known area, its name from the list.'
    ].join('\n')
  ].join('\n\n')
}

export interface Classification {
  /** The chat's area of life; null when the model gave nothing usable. */
  area: KnownArea | null
  roomId: string
  confidence: number
  /** True when the room came from the fallback rule rather than the model's own pick. */
  fellBack: boolean
  project:
    | { kind: 'none' }
    | { kind: 'new'; title: string; nextStep: string | null }
    | { kind: 'existing'; projectId: string }
}

/**
 * Applies the rules to the model's answer:
 *  - an unknown room, or confidence under the threshold, goes to the fallback room;
 *  - a project needs a title; an existing project must be open and in the chosen room.
 */
export function interpretClassification(
  raw: RawClassification,
  context: { roomIds: readonly string[]; fallbackRoomId: string; openProjects: readonly OpenProject[] }
): Classification {
  const known = context.roomIds.includes(raw.room_id)
  const confident = raw.confidence >= CONFIDENCE_THRESHOLD
  const fellBack = !known || !confident
  const roomId = fellBack ? context.fallbackRoomId : raw.room_id

  let project: Classification['project'] = { kind: 'none' }
  if (raw.is_project) {
    const existing = context.openProjects.find((p) => p.id === raw.existing_project_id)
    const title = raw.project_title?.trim() ?? ''
    if (existing && existing.roomId === roomId) project = { kind: 'existing', projectId: existing.id }
    else if (title !== '') project = { kind: 'new', title, nextStep: raw.next_step?.trim() || null }
  }
  const key = areaKey(raw.area)
  const area = key === '' ? null : { key, name: raw.area_name.trim() || key }
  return { area, roomId, confidence: raw.confidence, fellBack, project }
}

/** The area to store on the chat: only when it has none yet. An area, once set, is kept. */
export function areaChange(chat: { area: string | null }, result: Pick<Classification, 'area'>): KnownArea | null {
  return chat.area === null ? result.area : null
}

export interface ChatClassificationState {
  roomId: string | null
  roomSource: 'model' | 'user' | null
}

/**
 * Whether a classification may change the chat's room.
 *  - A chat the user moved is never touched.
 *  - A first classification always places the chat (in the fallback room if unsure).
 *  - A later one only moves it when the model itself was confident.
 */
export function roomChange(chat: ChatClassificationState, result: Classification): string | null {
  if (chat.roomSource === 'user') return null
  if (chat.roomId === null) return result.roomId
  if (result.fellBack || result.roomId === chat.roomId) return null
  return result.roomId
}

/**
 * Whether a chat is due for its quiet re-check: silent for at least
 * `QUIET_MINUTES`, and not classified since its last message.
 */
export function dueForQuietCheck(
  chat: { lastMessageAt: string | null; classifiedAt: string | null },
  now: Date
): boolean {
  if (chat.lastMessageAt === null) return false
  const last = Date.parse(chat.lastMessageAt)
  if (Number.isNaN(last) || now.getTime() - last < QUIET_MINUTES * 60_000) return false
  return chat.classifiedAt === null || Date.parse(chat.classifiedAt) < last
}
