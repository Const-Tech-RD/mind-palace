import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Catalog } from '@shared/catalog'
import { areaKey, type KnownArea } from '@shared/classify'
import { nextCell, type Cell } from '@shared/floor'
import {
  buildGroupingPrompt,
  buildMaterializePrompt,
  GROUPING_JSON_SCHEMA,
  GROUPING_SYSTEM_PROMPT,
  groupingSchema,
  interpretGrouping,
  interpretMaterialize,
  MATERIALIZE_JSON_SCHEMA,
  MATERIALIZE_SYSTEM_PROMPT,
  materializeSchema,
  type AreaChat
} from '@shared/roomPrompts'
import { ROOM_ACCENTS } from '@shared/rooms'
import { projectsToMove, suggestRooms, type Suggestion } from '@shared/suggest'
import type { JsonAnswer } from '../chat/claude'
import type { Store } from '../db/client'
import { chats, goalCompletions, messages, projectChats, projects } from '../db/schema'
import type { ProgressKeeper } from './progress'
import type { PalaceRepo } from './repo'
import type { RoomsRepo } from './roomsRepo'

/** Chats sent to the model when it furnishes a room. */
const MATERIALIZE_CHATS = 20
/** Chats per "Find my rooms" call. */
const GROUPING_BATCH = 60
const ROOM_NAME_MAX = 40

export interface RoomServiceDeps {
  store: Store
  roomsRepo: RoomsRepo
  palaceRepo: PalaceRepo
  keeper: ProgressKeeper
  catalog: () => Catalog
  askModel: (prompt: string, system: string, schema: Record<string, unknown>) => Promise<JsonAnswer>
  /** Tells the renderer that chats changed room. */
  onChanged: () => void
  now?: () => Date
}

/**
 * Making rooms. Nothing here runs on its own: every room is made by the
 * person's Materialize click, and only the Mail room's chats are ever moved
 * or re-tagged.
 */
export function createRoomService(deps: RoomServiceDeps) {
  const { store, roomsRepo, keeper } = deps
  const db = store.db
  const now = deps.now ?? (() => new Date())
  const mailRoom = (): string => deps.catalog().rules.classification.fallback_room
  const making = new Set<string>()

  /** The Mail room's chats in an area (or all of them), newest first, with their first user message. */
  function mailChats(area: string | null): Array<{ id: string } & AreaChat> {
    const rows = db
      .select({ id: chats.id, title: chats.title, area: chats.area, lastMessageAt: chats.lastMessageAt, createdAt: chats.createdAt })
      .from(chats)
      .where(area === null ? eq(chats.roomId, mailRoom()) : and(eq(chats.roomId, mailRoom()), eq(chats.area, area)))
      .all()
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
    if (rows.length === 0) return []
    const first = new Map<string, string>()
    const userMessages = db
      .select({ chatId: messages.chatId, content: messages.content })
      .from(messages)
      .where(and(inArray(messages.chatId, rows.map((r) => r.id)), eq(messages.role, 'user')))
      .orderBy(asc(messages.createdAt))
      .all()
    for (const m of userMessages) if (!first.has(m.chatId)) first.set(m.chatId, m.content)
    return rows.map((r) => ({ id: r.id, title: r.title || '(untitled)', firstMessage: first.get(r.id) ?? '' }))
  }

  function suggestions(): Suggestion[] {
    const catalog = deps.catalog()
    const rows = db.select({ roomId: chats.roomId, area: chats.area, areaName: chats.areaName, lastMessageAt: chats.lastMessageAt }).from(chats).all()
    const roomAreas = Object.values(catalog.rooms).flatMap((r) => (r.area ? [r.area] : []))
    return suggestRooms(rows, roomAreas, roomsRepo.dismissed(), mailRoom())
  }

  /** A room id from its name: lower case, unique, starting with a letter. */
  function roomIdFor(name: string, taken: ReadonlySet<string>): string {
    // Ids stay ASCII (they name tokens, settings and placements): drop what areaKey kept of other scripts.
    let base = areaKey(name).replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '') || 'room'
    if (!/^[a-z]/.test(base)) base = `room_${base}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
    return id
  }

  return {
    suggestions,

    /** Where a new room would go now. */
    nextCell(): Cell {
      return nextCell(Object.values(deps.catalog().rooms).map((r) => r.cell))
    },

    /** Makes the room for an area: one model call, then the area's Mail-room chats and their projects move in. */
    async materialize(area: string, name?: string): Promise<string> {
      const key = areaKey(area)
      if (making.has(key)) throw new Error('That room is already being made.')
      const before = deps.catalog()
      if (Object.values(before.rooms).some((r) => r.area === key)) throw new Error(`There is already a room for "${area}".`)
      const areaChats = mailChats(key)
      if (areaChats.length === 0) throw new Error(`There are no chats about "${area}" in the Mail room.`)
      const suggested = suggestions().find((s) => s.area === key)?.name ?? key

      making.add(key)
      try {
        const prompt = buildMaterializePrompt({
          area: key,
          name: name?.trim() || suggested,
          chats: areaChats.slice(0, MATERIALIZE_CHATS),
          library: Object.values(before.library),
          slots: before.rules.layout.slots
        })
        const answer = await deps.askModel(prompt, MATERIALIZE_SYSTEM_PROMPT, MATERIALIZE_JSON_SCHEMA)
        if (!answer.ok) throw new Error(`The room could not be made: ${answer.error}`)
        const parsed = materializeSchema.safeParse(answer.value)
        if (!parsed.success) throw new Error(`The room could not be made: the answer did not match the expected shape (${parsed.error.issues[0]?.message ?? 'invalid'}).`)

        const catalog = deps.catalog()
        if (Object.values(catalog.rooms).some((r) => r.area === key)) throw new Error(`There is already a room for "${area}".`)
        const room = interpretMaterialize(parsed.data, catalog, suggested)
        const roomName = (name?.trim() || room.name).slice(0, ROOM_NAME_MAX)
        const rows = roomsRepo.rows()
        const usedAccents = new Set(rows.map((r) => r.accent))
        const accent = [...Array(ROOM_ACCENTS).keys()].find((i) => !usedAccents.has(i)) ?? rows.length % ROOM_ACCENTS
        const cell = nextCell(Object.values(catalog.rooms).map((r) => r.cell))
        const id = roomIdFor(roomName, new Set(Object.keys(catalog.rooms)))

        // Earned stays earned: the Mail room's marks are stored before its chats leave.
        keeper.record()
        store.db.transaction((tx) => {
          roomsRepo.insert({
            id,
            name: roomName,
            area: key,
            accent,
            cellX: cell[0],
            cellY: cell[1],
            signature: room.signature,
            classifier: room.classifier,
            createdAt: now().toISOString()
          })
          tx.update(chats).set({ roomId: id, roomSource: 'model' }).where(and(eq(chats.roomId, mailRoom()), eq(chats.area, key))).run()
          const linked = tx.select({ projectId: projectChats.projectId, chatId: projectChats.chatId }).from(projectChats).all()
          const byProject = new Map<string, string[]>()
          for (const link of linked) byProject.set(link.projectId, [...(byProject.get(link.projectId) ?? []), link.chatId])
          const roomOf = new Map(tx.select({ id: chats.id, roomId: chats.roomId }).from(chats).all().map((c) => [c.id, c.roomId]))
          const candidates = tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.roomId, mailRoom()))
            .all()
            .map((p) => ({ id: p.id, chatIds: byProject.get(p.id) ?? [] }))
          const moving = projectsToMove(candidates, (chatId) => roomOf.get(chatId) ?? null, id)
          if (moving.length > 0) {
            tx.update(projects).set({ roomId: id }).where(inArray(projects.id, moving)).run()
            tx.update(goalCompletions).set({ roomId: id }).where(inArray(goalCompletions.projectId, moving)).run()
          }
        })
        deps.onChanged()
        return id
      } finally {
        making.delete(key)
      }
    },

    /** "Not now": the area stays a tag until 5 more chats arrive in it. */
    dismiss(area: string): void {
      const key = areaKey(area)
      const suggestion = suggestions().find((s) => s.area === key)
      const count = mailChats(key).length
      roomsRepo.dismiss(key, suggestion?.name ?? key, count, now().toISOString())
    },

    rename(roomId: string, name: string): void {
      const trimmed = name.trim()
      if (trimmed === '' || trimmed.length > ROOM_NAME_MAX) throw new Error(`A room name is 1 to ${ROOM_NAME_MAX} characters.`)
      if (!roomsRepo.rows().some((r) => r.id === roomId)) throw new Error(roomId === mailRoom() ? 'The Mail room keeps its name.' : `There is no room "${roomId}".`)
      roomsRepo.rename(roomId, trimmed)
    },

    /** "Find my rooms": the model tags the Mail room's chats with areas, a batch at a time. Returns how many were tagged. */
    async findAreas(): Promise<number> {
      const all = mailChats(null)
      const known: KnownArea[] = deps.palaceRepo.knownAreas()
      let tagged = 0
      for (let i = 0; i < all.length; i += GROUPING_BATCH) {
        const batch = all.slice(i, i + GROUPING_BATCH)
        const answer = await deps.askModel(buildGroupingPrompt({ sessions: batch, knownAreas: known }), GROUPING_SYSTEM_PROMPT, GROUPING_JSON_SCHEMA)
        if (!answer.ok) throw new Error(`Finding rooms failed: ${answer.error}`)
        const parsed = groupingSchema.safeParse(answer.value)
        if (!parsed.success) throw new Error('Finding rooms failed: the answer did not match the expected shape.')
        const tags = interpretGrouping(parsed.data, batch.map((c) => c.id))
        store.db.transaction(() => {
          for (const [chatId, area] of tags) {
            // Only chats still in the Mail room; anything moved meanwhile keeps its area.
            const row = db.select({ roomId: chats.roomId }).from(chats).where(eq(chats.id, chatId)).get()
            if (row?.roomId !== mailRoom()) continue
            db.update(chats).set({ area: area.key, areaName: area.name }).where(eq(chats.id, chatId)).run()
            tagged++
            if (!known.some((k) => k.key === area.key)) known.push(area)
          }
        })
      }
      deps.onChanged()
      return tagged
    }
  }
}

export type RoomService = ReturnType<typeof createRoomService>
