import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { ReminderItem, ReminderOutcome, ReminderProject } from '@shared/reminders'
import type { Db } from '../db/client'
import { chats, projectChats, projects, reminders } from '../db/schema'

export interface NudgeSource {
  title: string
  nextStep: string | null
  chatIds: string[]
}

export function createReminderRepo(db: Db) {
  const latestChatOf = (projectId: string): string | null =>
    db
      .select({ id: chats.id })
      .from(projectChats)
      .innerJoin(chats, eq(chats.id, projectChats.chatId))
      .where(eq(projectChats.projectId, projectId))
      .orderBy(sql`coalesce(${chats.lastMessageAt}, ${chats.createdAt}) desc`)
      .get()?.id ?? null

  return {
    activeProjects(): ReminderProject[] {
      return db
        .select({
          id: projects.id,
          state: projects.state,
          lastActivityAt: projects.lastActivityAt,
          createdAt: projects.createdAt,
          snoozedUntil: projects.snoozedUntil,
          remindersSent: projects.remindersSent
        })
        .from(projects)
        .where(eq(projects.state, 'active'))
        .all()
    },

    nudgeSource(projectId: string): NudgeSource | undefined {
      const project = db
        .select({ title: projects.title, nextStep: projects.nextStep })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
      if (!project) return undefined
      const chatIds = db
        .select({ id: chats.id })
        .from(projectChats)
        .innerJoin(chats, eq(chats.id, projectChats.chatId))
        .where(eq(projectChats.projectId, projectId))
        .orderBy(asc(sql`coalesce(${chats.lastMessageAt}, ${chats.createdAt})`))
        .all()
        .map((row) => row.id)
      return { ...project, chatIds }
    },

    /** Stores the reminder and moves the project's cadence forward, together. */
    create(input: { projectId: string; dueAt: string; message: string; remindersSent: number }): string {
      const id = randomUUID()
      db.transaction((tx) => {
        tx.insert(reminders).values({ id, projectId: input.projectId, dueAt: input.dueAt, message: input.message }).run()
        tx.update(projects).set({ remindersSent: input.remindersSent }).where(eq(projects.id, input.projectId)).run()
      })
      return id
    },

    markNotified(reminderId: string, at: string): void {
      db.update(reminders).set({ sentAt: at }).where(eq(reminders.id, reminderId)).run()
    },

    /** `sent_at` of every notification shown at or after `since`. */
    notifiedSince(since: string): string[] {
      return db
        .select({ sentAt: reminders.sentAt })
        .from(reminders)
        .where(and(isNotNull(reminders.sentAt), sql`${reminders.sentAt} >= ${since}`))
        .all()
        .map((row) => row.sentAt!)
    },

    projectOf(reminderId: string): string | undefined {
      return db.select({ id: reminders.projectId }).from(reminders).where(eq(reminders.id, reminderId)).get()?.id
    },

    /** Gives every reminder of the project that is still waiting its outcome. Returns how many. */
    resolve(projectId: string, outcome: ReminderOutcome): number {
      return db
        .update(reminders)
        .set({ action: outcome })
        .where(and(eq(reminders.projectId, projectId), isNull(reminders.action)))
        .run().changes
    },

    /** Reminders still waiting for a reaction, newest first. */
    waiting(): ReminderItem[] {
      return db
        .select({
          id: reminders.id,
          projectId: reminders.projectId,
          projectTitle: projects.title,
          roomId: projects.roomId,
          message: reminders.message,
          dueAt: reminders.dueAt,
          sentAt: reminders.sentAt
        })
        .from(reminders)
        .innerJoin(projects, eq(projects.id, reminders.projectId))
        .where(isNull(reminders.action))
        .orderBy(desc(reminders.dueAt))
        .all()
        .map(({ sentAt, message, ...row }) => ({
          ...row,
          message: message ?? '',
          notified: sentAt !== null,
          chatId: latestChatOf(row.projectId)
        }))
    },

    item(reminderId: string): ReminderItem | undefined {
      return this.waiting().find((item) => item.id === reminderId)
    }
  }
}

export type ReminderRepo = ReturnType<typeof createReminderRepo>
