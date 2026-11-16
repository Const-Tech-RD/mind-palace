import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { KnownArea, OpenProject } from '@shared/classify'
import type { ProjectState, ProjectSummary } from '@shared/projects'
import type { Db } from '../db/client'
import { chats, goalCompletions, projectChats, projects, rooms } from '../db/schema'

type ProjectRecord = typeof projects.$inferSelect

export interface ChatClassificationRow {
  id: string
  roomId: string | null
  roomSource: 'model' | 'user' | null
  classifiedAt: string | null
  lastMessageAt: string | null
  suggestedProjectId: string | null
  projectDismissedAt: string | null
  area: string | null
  areaName: string | null
}

/** Rooms, classification state and projects: everything phase 2 stores. */
export function createPalaceRepo(db: Db) {
  const chatState = {
    id: chats.id,
    roomId: chats.roomId,
    roomSource: chats.roomSource,
    classifiedAt: chats.classifiedAt,
    lastMessageAt: chats.lastMessageAt,
    suggestedProjectId: chats.suggestedProjectId,
    projectDismissedAt: chats.projectDismissedAt,
    area: chats.area,
    areaName: chats.areaName
  }

  function summarize(rows: ProjectRecord[]): ProjectSummary[] {
    if (rows.length === 0) return []
    const links = db
      .select({ projectId: projectChats.projectId, chatId: projectChats.chatId })
      .from(projectChats)
      .innerJoin(chats, eq(chats.id, projectChats.chatId))
      .where(inArray(projectChats.projectId, rows.map((r) => r.id)))
      .orderBy(sql`coalesce(${chats.lastMessageAt}, ${chats.createdAt}) desc`)
      .all()
    const chatIds = new Map<string, string[]>()
    for (const link of links) {
      const list = chatIds.get(link.projectId)
      if (list) list.push(link.chatId)
      else chatIds.set(link.projectId, [link.chatId])
    }
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      roomId: row.roomId,
      state: row.state,
      nextStep: row.nextStep,
      lastActivityAt: row.lastActivityAt,
      snoozedUntil: row.snoozedUntil,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      chatIds: chatIds.get(row.id) ?? []
    }))
  }

  return {
    chat(chatId: string): ChatClassificationRow | undefined {
      return db.select(chatState).from(chats).where(eq(chats.id, chatId)).get()
    },

    /** Every chat with at least one message; the caller decides which are due. */
    chatsWithMessages(): ChatClassificationRow[] {
      return db.select(chatState).from(chats).where(sql`${chats.lastMessageAt} is not null`).all()
    },

    setRoom(chatId: string, roomId: string, source: 'model' | 'user'): void {
      db.update(chats).set({ roomId, roomSource: source }).where(eq(chats.id, chatId)).run()
    },

    setArea(chatId: string, key: string, name: string): void {
      db.update(chats).set({ area: key, areaName: name }).where(eq(chats.id, chatId)).run()
    },

    /** Every area named so far: the rooms' areas first, then the chats' (first name seen wins). */
    knownAreas(): KnownArea[] {
      const known = new Map<string, string>()
      for (const room of db.select({ area: rooms.area, name: rooms.name }).from(rooms).all()) known.set(room.area, room.name)
      const tagged = db
        .select({ area: chats.area, name: chats.areaName })
        .from(chats)
        .where(sql`${chats.area} is not null`)
        .orderBy(chats.createdAt)
        .all()
      for (const chat of tagged) if (chat.area && !known.has(chat.area)) known.set(chat.area, chat.name ?? chat.area)
      return [...known].map(([key, name]) => ({ key, name }))
    },

    markClassified(chatId: string, at: string): void {
      db.update(chats).set({ classifiedAt: at }).where(eq(chats.id, chatId)).run()
    },

    setSuggestion(chatId: string, projectId: string | null): void {
      db.update(chats).set({ suggestedProjectId: projectId }).where(eq(chats.id, chatId)).run()
    },

    dismissSuggestion(chatId: string, at: string): void {
      db.update(chats).set({ suggestedProjectId: null, projectDismissedAt: at }).where(eq(chats.id, chatId)).run()
    },

    hasTrackedProject(chatId: string): boolean {
      const row = db
        .select({ id: projects.id })
        .from(projectChats)
        .innerJoin(projects, eq(projects.id, projectChats.projectId))
        .where(and(eq(projectChats.chatId, chatId), sql`${projects.state} != 'suggested'`))
        .get()
      return row !== undefined
    },

    /** Projects the classifier may recognise a chat as continuing. */
    openProjects(): OpenProject[] {
      return db
        .select({ id: projects.id, title: projects.title, roomId: projects.roomId })
        .from(projects)
        .where(inArray(projects.state, ['active', 'paused']))
        .orderBy(desc(projects.createdAt))
        .all()
    },

    project(projectId: string): ProjectSummary | undefined {
      const row = db.select().from(projects).where(eq(projects.id, projectId)).get()
      return row ? summarize([row])[0] : undefined
    },

    projects(): ProjectSummary[] {
      return summarize(db.select().from(projects).orderBy(desc(projects.createdAt)).all())
    },

    createSuggested(input: { title: string; roomId: string; originChatId: string; nextStep: string | null; at: string }): string {
      const id = randomUUID()
      db.insert(projects)
        .values({
          id,
          title: input.title,
          roomId: input.roomId,
          originChatId: input.originChatId,
          state: 'suggested',
          nextStep: input.nextStep,
          createdAt: input.at
        })
        .run()
      return id
    },

    originChatOf(projectId: string): string | null {
      return db.select({ c: projects.originChatId }).from(projects).where(eq(projects.id, projectId)).get()?.c ?? null
    },

    linkChat(projectId: string, chatId: string): void {
      db.insert(projectChats).values({ projectId, chatId }).onConflictDoNothing().run()
    },

    updateProject(
      projectId: string,
      change: {
        state?: ProjectState
        closedAt?: string | null
        snoozedUntil?: string | null
        lastActivityAt?: string | null
      }
    ): void {
      db.update(projects).set(change).where(eq(projects.id, projectId)).run()
    },

    deleteProject(projectId: string): void {
      db.delete(projects).where(eq(projects.id, projectId)).run()
    },

    /**
     * Moves `last_activity_at` forward on every tracked project the chat
     * belongs to and restarts their reminder cadence. Returns the project ids.
     */
    touchProjectsOfChat(chatId: string, at: string): string[] {
      const ids = db
        .select({ id: projectChats.projectId })
        .from(projectChats)
        .where(eq(projectChats.chatId, chatId))
        .all()
        .map((r) => r.id)
      if (ids.length === 0) return []
      db.update(projects).set({ lastActivityAt: at, remindersSent: 0 }).where(inArray(projects.id, ids)).run()
      return ids
    },

    addCompletion(input: { projectId: string; roomId: string; localDay: string }): void {
      db.insert(goalCompletions).values({ id: randomUUID(), ...input }).run()
    },

    removeCompletions(projectId: string): void {
      db.delete(goalCompletions).where(eq(goalCompletions.projectId, projectId)).run()
    },

    transaction<T>(run: () => T): T {
      return db.transaction(() => run())
    }
  }
}

export type PalaceRepo = ReturnType<typeof createPalaceRepo>
