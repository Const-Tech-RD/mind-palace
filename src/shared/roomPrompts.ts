/**
 * The two rare model calls rooms need, pure: what to send and how to read the
 * answer. `askJson` (src/main/chat/claude.ts) makes the call.
 *
 *  - Materialize: name a new room, write its classifier text, and pick up to
 *    five signature items from the library.
 *  - Grouping ("Find my rooms"): tag a batch of Mail-room chats with areas.
 */
import { z } from 'zod'
import type { Catalog, LibraryItem, SlotDef } from './catalog'
import { areaKey, type KnownArea } from './classify'
import { fits } from './placements'
import type { RoomClassifierText, StoredSignatureStep } from './rooms'

/** Signature picks a room may have. */
export const MAX_SIGNATURE = 5
const MAX_TEXT = 300
const clip = (text: string, limit = MAX_TEXT): string => (text.length <= limit ? text : `${text.slice(0, limit)} […]`)

export interface AreaChat {
  title: string
  firstMessage: string
}

// --- Materialize -------------------------------------------------------------

export const materializeSchema = z.object({
  name: z.string(),
  belongs: z.string(),
  not_here: z.string(),
  examples: z.array(z.string()).min(1).max(4),
  items: z.array(z.object({ item: z.string(), slot: z.string() }))
})
export type RawMaterialize = z.infer<typeof materializeSchema>

export const MATERIALIZE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'belongs', 'not_here', 'examples', 'items'],
  properties: {
    name: { type: 'string' },
    belongs: { type: 'string' },
    not_here: { type: 'string' },
    examples: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['item', 'slot'], properties: { item: { type: 'string' }, slot: { type: 'string' } } }
    }
  }
} as const

export const MATERIALIZE_SYSTEM_PROMPT = [
  'You furnish a new room in a memory palace: a room stands for one area of the person\'s life.',
  'You name the room, write how to recognise chats that belong in it, and pick its signature furniture from a fixed library.',
  'Answer with the JSON object only.'
].join(' ')

export function buildMaterializePrompt(input: {
  area: string
  name: string
  chats: AreaChat[]
  library: LibraryItem[]
  slots: Readonly<Record<string, SlotDef>>
}): string {
  const chats = input.chats.map((c) => `- ${clip(c.title, 80)}: ${clip(c.firstMessage)}`).join('\n')
  const library = input.library
    .map((item) => `- ${item.id} · areas: ${item.areas.join(', ')} · stands in: ${item.slots.join(', ')}${item.slot ? ` · usual spot: ${item.slot}` : ''}`)
    .join('\n')
  const slots = Object.entries(input.slots)
    .filter(([, slot]) => slot.kind !== 'desk' && slot.kind !== 'trophy_shelf')
    .map(([id, slot]) => `- ${id} (${slot.kind})`)
    .join('\n')
  return [
    `## The area: ${input.name} (key "${input.area}")`,
    '## Chats in it',
    chats,
    '## Library',
    library,
    '## Spots in the room',
    slots,
    '## Your answer',
    [
      `- name: the room's name, 1 to 3 words (for example "${input.name}").`,
      '- belongs: one or two sentences on which chats belong in this room, broad enough for the whole area.',
      '- not_here: what looks close but belongs elsewhere, or an empty string.',
      '- examples: 2 to 4 short example requests that belong here.',
      `- items: up to ${MAX_SIGNATURE} library items, in order (the first is in the room from the start; the others arrive as the person keeps coming back). Prefer items tagged with this area. Each needs a spot from the list whose kind the item stands in, and no two items share a spot.`
    ].join('\n')
  ].join('\n\n')
}

/** What to store for the new room. Bad picks are dropped; the room is made either way. */
export function interpretMaterialize(
  raw: RawMaterialize,
  catalog: Catalog,
  fallbackName = 'New room'
): { name: string; classifier: RoomClassifierText; signature: StoredSignatureStep[] } {
  const slots = catalog.rules.layout.slots
  const hosts = new Set(Object.values(slots).flatMap((s) => (s.host ? [s.host] : [])))
  const used = new Set<string>()
  const items = new Set<string>()
  const signature: StoredSignatureStep[] = []
  for (const pick of raw.items) {
    if (signature.length >= MAX_SIGNATURE) break
    const def = catalog.library[pick.item]
    const slot = slots[pick.slot]
    if (!def || !slot || hosts.has(pick.slot) || used.has(pick.slot) || items.has(pick.item) || !fits(def, slot)) continue
    used.add(pick.slot)
    items.add(pick.item)
    signature.push({ item: pick.item, slots: [pick.slot] })
  }
  return {
    name: clip(raw.name.trim(), 40) || fallbackName,
    classifier: {
      belongs: raw.belongs.trim(),
      not_here: raw.not_here.trim(),
      examples: raw.examples.map((e) => e.trim()).filter((e) => e !== '')
    },
    signature
  }
}

// --- Grouping ("Find my rooms") ---------------------------------------------

export const groupingSchema = z.object({
  areas: z.array(z.object({ key: z.string(), name: z.string(), session_ids: z.array(z.string()) }))
})
export type RawGrouping = z.infer<typeof groupingSchema>

export const GROUPING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['areas'],
  properties: {
    areas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name', 'session_ids'],
        properties: { key: { type: 'string' }, name: { type: 'string' }, session_ids: { type: 'array', items: { type: 'string' } } }
      }
    }
  }
} as const

export const GROUPING_SYSTEM_PROMPT = [
  'You group a person\'s chats by the area of their life each is about.',
  'An area is broad, like a part of someone\'s life (software, finance, 3D printing, cooking, health), never a single project or tool: all software projects are one area.',
  'Two areas that each exist without the other stay separate. Answer with the JSON object only.'
].join(' ')

export function buildGroupingPrompt(input: { sessions: Array<{ id: string } & AreaChat>; knownAreas: KnownArea[] }): string {
  const known = input.knownAreas.length === 0 ? 'None yet.' : input.knownAreas.map((a) => `- ${a.key} — ${a.name}`).join('\n')
  const sessions = input.sessions.map((s) => `- ${s.id} · ${clip(s.title, 80)}: ${clip(s.firstMessage)}`).join('\n')
  return [
    '## Known areas',
    known,
    '## Chats',
    sessions,
    '## Your answer',
    [
      '- areas: every area you find, each with key (short, lower case, reuse a known key when it fits), name (a few words) and session_ids (the chat ids in it).',
      '- Put each chat in exactly one area. Leave out a chat that has no clear area.'
    ].join('\n')
  ].join('\n\n')
}

/** Chat id → its area, for ids that were asked about. A chat named twice keeps its first area. */
export function interpretGrouping(raw: RawGrouping, sessionIds: readonly string[]): Map<string, KnownArea> {
  const asked = new Set(sessionIds)
  const tags = new Map<string, KnownArea>()
  for (const group of raw.areas) {
    const key = areaKey(group.key)
    if (key === '') continue
    const name = group.name.trim() || key
    for (const id of group.session_ids) if (asked.has(id) && !tags.has(id)) tags.set(id, { key, name })
  }
  return tags
}
