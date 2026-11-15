import { randomUUID } from 'node:crypto'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { splitSources, type ChatMessage, type ChatRole, type ChatSummary } from '@shared/chat'
import type { Db } from '../db/client'
import { chats, messages, projectChats, projects } from '../db/schema'

export interface ChatRow extends ChatSummary {
  sdkSessionId: string | null
}

const toMessage = (row: typeof messages.$inferSelect): ChatMessage => ({
  id: row.id,
  chatId: row.chatId,
  role: row.role,
  content: row.content,
  createdAt: row.createdAt,
  sources: row.role === 'assistant' ? splitSources(row.content).sources : []
})

type ChatRecord = typeof chats.$inferSelect

const toChat = (
  row: ChatRecord,
  project: ChatSummary['project'] = null,
  suggestion: ChatSummary['suggestion'] = null
): ChatRow => ({
  id: row.id,
  title: row.title,
  roomId: row.roomId,
  roomSource: row.roomSource,
  createdAt: row.createdAt,
  lastMessageAt: row.lastMessageAt,
  project,
  suggestion,
  sdkSessionId: row.sdkSessionId
})

/** Every read and write the chat needs. Timestamps are UTC ISO-8601, as in the schema. */
export function createChatRepo(db: Db, now: () => Date = () => new Date()) {
  /** Adds the project a chat belongs to and the suggestion waiting on it. */
  function decorate(rows: ChatRecord[]): ChatRow[] {
    if (rows.length === 0) return []
    const all = db.select().from(projects).all()
    const byId = new Map(all.map((p) => [p.id, p]))
    // A chat is shown under its most recently created tracked project.
    const linked = new Map<string, { id: string; title: string }>()
    const links = db
      .select({ chatId: projectChats.chatId, projectId: projectChats.projectId })
      .from(projectChats)
      .innerJoin(projects, eq(projects.id, projectChats.projectId))
      .orderBy(desc(projects.createdAt))
      .all()
    for (const link of links) {
      const project = byId.get(link.projectId)
      if (project && project.state !== 'suggested' && !linked.has(link.chatId)) {
        linked.set(link.chatId, { id: project.id, title: project.title })
      }
    }
    return rows.map((row) => {
      const offered = row.suggestedProjectId ? byId.get(row.suggestedProjectId) : undefined
      return toChat(
        row,
        linked.get(row.id) ?? null,
        offered
          ? {
              projectId: offered.id,
              title: offered.title,
              nextStep: offered.nextStep,
              existing: offered.state !== 'suggested'
            }
          : null
      )
    })
  }

  return {
    list(): ChatSummary[] {
      const rows = db
        .select()
        .from(chats)
        .orderBy(sql`coalesce(${chats.lastMessageAt}, ${chats.createdAt}) desc`)
        .all()
      return decorate(rows).map(({ sdkSessionId: _session, ...summary }) => summary)
    },

    get(chatId: string): ChatRow | undefined {
      const row = db.select().from(chats).where(eq(chats.id, chatId)).get()
      return row ? decorate([row])[0] : undefined
    },

    create(title: string): ChatRow {
      const row = { id: randomUUID(), title, createdAt: now().toISOString() }
      db.insert(chats).values(row).run()
      return {
        ...row,
        roomId: null,
        roomSource: null,
        lastMessageAt: null,
        project: null,
        suggestion: null,
        sdkSessionId: null
      }
    },

    messages(chatId: string): ChatMessage[] {
      return db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), asc(sql`rowid`))
        .all()
        .map(toMessage)
    },

    /** Stores a message and moves the chat's `last_message_at` forward. */
    addMessage(input: {
      chatId: string
      role: ChatRole
      content: string
      tokensIn?: number
      tokensOut?: number
    }): ChatMessage {
      const createdAt = now().toISOString()
      const row = {
        id: randomUUID(),
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        createdAt,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null
      }
      db.transaction((tx) => {
        tx.insert(messages).values(row).run()
        tx.update(chats).set({ lastMessageAt: createdAt }).where(eq(chats.id, input.chatId)).run()
      })
      return toMessage(row)
    },

    setSession(chatId: string, sdkSessionId: string | null): void {
      db.update(chats).set({ sdkSessionId }).where(eq(chats.id, chatId)).run()
    },

    /** Removes the chat; its messages go with it through the foreign key. */
    delete(chatId: string): boolean {
      return db.delete(chats).where(eq(chats.id, chatId)).run().changes > 0
    }
  }
}

export type ChatRepo = ReturnType<typeof createChatRepo>
