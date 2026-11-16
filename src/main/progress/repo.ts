/** Database access for project progress. Every rule lives in src/shared; this only reads and writes rows. */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Milestone, Proposal, FreshProposal } from '@shared/milestones'
import type { ChatDigest } from '@shared/progressPrompts'
import type { Store } from '../db/client'
import { chatDigests, chatFiles, chats, messages, milestoneProposals, milestones, projectChats, projects, sweepDismissals } from '../db/schema'

export interface ProjectRow {
  id: string
  title: string
  roomId: string
  folder: string | null
  gitRoot: string | null
  folderSource: 'detected' | 'user' | null
  sweptAt: string | null
}

export function createProgressRepo(store: Store) {
  const db = store.db

  const toMilestone = (r: typeof milestones.$inferSelect): Milestone => ({
    id: r.id,
    title: r.title,
    originalTitle: r.originalTitle,
    position: r.position,
    status: r.status,
    doneOn: r.doneOn,
    evidence: r.evidence,
    evidenceRef: r.evidenceRef,
    edited: r.edited,
    statusByUser: r.statusByUser,
    deletedAt: r.deletedAt
  })

  const toProposal = (r: typeof milestoneProposals.$inferSelect): Proposal => ({
    id: r.id,
    kind: r.kind,
    milestoneId: r.milestoneId,
    title: r.title,
    afterId: r.afterId,
    evidence: r.evidence,
    evidenceRef: r.evidenceRef,
    doneOn: r.doneOn,
    answered: r.answered
  })

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)
    },

    project(projectId: string): ProjectRow | null {
      const row = db
        .select({
          id: projects.id,
          title: projects.title,
          roomId: projects.roomId,
          folder: projects.folder,
          gitRoot: projects.gitRoot,
          folderSource: projects.folderSource,
          sweptAt: projects.sweptAt
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
      return row ?? null
    },

    /** Every milestone, tombstones included. */
    milestones(projectId: string): Milestone[] {
      return db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.position)).all().map(toMilestone)
    },

    /** Writes the whole list back: new rows inserted, the rest updated. */
    saveMilestones(projectId: string, list: Milestone[]): void {
      const existing = new Set(db.select({ id: milestones.id }).from(milestones).where(eq(milestones.projectId, projectId)).all().map((r) => r.id))
      for (const m of list) {
        const values = { ...m, projectId }
        if (existing.has(m.id)) db.update(milestones).set(values).where(eq(milestones.id, m.id)).run()
        else db.insert(milestones).values(values).run()
      }
    },

    proposals(projectId: string): Proposal[] {
      return db.select().from(milestoneProposals).where(eq(milestoneProposals.projectId, projectId)).orderBy(asc(milestoneProposals.createdAt)).all().map(toProposal)
    },

    proposal(proposalId: string): (Proposal & { projectId: string }) | null {
      const row = db.select().from(milestoneProposals).where(eq(milestoneProposals.id, proposalId)).get()
      return row ? { ...toProposal(row), projectId: row.projectId } : null
    },

    addProposals(projectId: string, fresh: FreshProposal[]): void {
      for (const p of fresh) db.insert(milestoneProposals).values({ ...p, id: randomUUID(), projectId }).run()
    },

    answerProposal(proposalId: string, answer: 'accepted' | 'dismissed'): void {
      db.update(milestoneProposals).set({ answered: answer }).where(eq(milestoneProposals.id, proposalId)).run()
    },

    linkedChatIds(projectId: string): string[] {
      return db.select({ chatId: projectChats.chatId }).from(projectChats).where(eq(projectChats.projectId, projectId)).all().map((r) => r.chatId)
    },

    /**
     * Chats the sweep may offer: in the given rooms, linked to no project, not
     * dismissed for this one, and (when `since` is set) active after it.
     */
    sweepCandidates(projectId: string, roomIds: string[], since: string | null): Array<{ id: string; title: string; lastAt: string }> {
      const linked = db.select({ chatId: projectChats.chatId }).from(projectChats).all().map((r) => r.chatId)
      const dismissed = db
        .select({ chatId: sweepDismissals.chatId })
        .from(sweepDismissals)
        .where(eq(sweepDismissals.projectId, projectId))
        .all()
        .map((r) => r.chatId)
      const skip = [...new Set([...linked, ...dismissed])]
      const rows = db
        .select({ id: chats.id, title: chats.title, lastMessageAt: chats.lastMessageAt, createdAt: chats.createdAt })
        .from(chats)
        .where(skip.length > 0 ? and(inArray(chats.roomId, roomIds), notInArray(chats.id, skip)) : inArray(chats.roomId, roomIds))
        .all()
      return rows
        .map((r) => ({ id: r.id, title: r.title || '(untitled)', lastAt: r.lastMessageAt ?? r.createdAt }))
        .filter((r) => since === null || r.lastAt > since)
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    },

    /** Each chat's first user message, for prompts. */
    firstMessages(chatIds: string[]): Map<string, string> {
      const first = new Map<string, string>()
      if (chatIds.length === 0) return first
      const rows = db
        .select({ chatId: messages.chatId, content: messages.content })
        .from(messages)
        .where(and(inArray(messages.chatId, chatIds), eq(messages.role, 'user')))
        .orderBy(asc(messages.createdAt))
        .all()
      for (const r of rows) if (!first.has(r.chatId)) first.set(r.chatId, r.content)
      return first
    },

    chatTitles(chatIds: string[]): Map<string, string> {
      if (chatIds.length === 0) return new Map()
      return new Map(db.select({ id: chats.id, title: chats.title }).from(chats).where(inArray(chats.id, chatIds)).all().map((r) => [r.id, r.title || '(untitled)']))
    },

    setSweptAt(projectId: string, at: string): void {
      db.update(projects).set({ sweptAt: at }).where(eq(projects.id, projectId)).run()
    },

    /**
     * Links accepted chats, remembers dismissed ones, and moves an accepted chat
     * into the project's room unless the person placed it themselves.
     */
    link(projectId: string, roomId: string, accept: string[], dismiss: string[]): void {
      for (const chatId of accept) db.insert(projectChats).values({ projectId, chatId }).onConflictDoNothing().run()
      for (const chatId of dismiss) db.insert(sweepDismissals).values({ projectId, chatId }).onConflictDoNothing().run()
      if (accept.length > 0) {
        db.update(chats)
          .set({ roomId, roomSource: 'model' })
          .where(and(inArray(chats.id, accept), notInArray(chats.roomSource, ['user'])))
          .run()
        // A chat never classified has a null source: `not in` skips nulls in SQL, so those move separately.
        db.update(chats).set({ roomId, roomSource: 'model' }).where(and(inArray(chats.id, accept), isNull(chats.roomSource))).run()
      }
    },

    /** Files the linked chats edited. */
    editedFiles(chatIds: string[]): Array<{ path: string; edits: number }> {
      if (chatIds.length === 0) return []
      return db.select({ path: chatFiles.path, edits: chatFiles.edits }).from(chatFiles).where(inArray(chatFiles.chatId, chatIds)).all()
    },

    setFolder(projectId: string, folder: string | null, gitRoot: string | null, source: 'detected' | 'user'): void {
      db.update(projects).set({ folder, gitRoot, folderSource: source }).where(eq(projects.id, projectId)).run()
    },

    /** A chat's messages in order, for its digest. */
    chatMessages(chatId: string): Array<{ role: string; content: string; createdAt: string; localDay: string | null }> {
      return db
        .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt, localDay: messages.localDay })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt))
        .all()
    },

    digest(chatId: string): { digest: ChatDigest; throughMessageAt: string } | null {
      const row = db.select().from(chatDigests).where(eq(chatDigests.chatId, chatId)).get()
      return row ? { digest: JSON.parse(row.digest) as ChatDigest, throughMessageAt: row.throughMessageAt } : null
    },

    saveDigest(chatId: string, digest: ChatDigest, throughMessageAt: string): void {
      db.insert(chatDigests)
        .values({ chatId, digest: JSON.stringify(digest), throughMessageAt })
        .onConflictDoUpdate({ target: chatDigests.chatId, set: { digest: JSON.stringify(digest), throughMessageAt } })
        .run()
    },

    /** Projects linking a chat. */
    projectsOfChat(chatId: string): string[] {
      return db.select({ projectId: projectChats.projectId }).from(projectChats).where(eq(projectChats.chatId, chatId)).all().map((r) => r.projectId)
    }
  }
}

export type ProgressRepo = ReturnType<typeof createProgressRepo>
