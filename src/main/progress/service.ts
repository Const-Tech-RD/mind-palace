/**
 * Project progress: the sweep for a project's chats, chat digests, the first
 * draft of milestones and later refreshes (proposals only), hand edits, and the
 * project's folder. Rules come from src/shared/milestones, folders and
 * progressPrompts; this layer reads, calls the model and writes.
 */
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { localDayOf } from '@shared/engine/days'
import { detectFolder, normPath, type EditFact } from '@shared/folders'
import {
  acceptProposal,
  applyEdit,
  filterProposals,
  progressOf,
  type Milestone,
  type MilestoneEdit,
  type ProjectProgress,
  type SweepCandidate
} from '@shared/milestones'
import {
  buildDigestPrompt,
  buildDraftPrompt,
  buildRefreshPrompt,
  buildSweepPrompt,
  DIGEST_JSON_SCHEMA,
  DIGEST_SYSTEM_PROMPT,
  digestSchema,
  DRAFT_JSON_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  draftSchema,
  interpretDigest,
  interpretDraft,
  interpretRefresh,
  interpretSweep,
  REFRESH_JSON_SCHEMA,
  REFRESH_SYSTEM_PROMPT,
  refreshSchema,
  SWEEP_BATCH,
  SWEEP_JSON_SCHEMA,
  SWEEP_SYSTEM_PROMPT,
  sweepSchema,
  type ChatDigest,
  type KnownEvidence
} from '@shared/progressPrompts'
import type { JsonAnswer } from '../chat/claude'
import { gitRootOf, isSharedRoot, readEvidence, type Evidence } from './evidence'
import type { ProgressRepo } from './repo'

type AskModel = (prompt: string, system: string, schema: Record<string, unknown>) => Promise<JsonAnswer>

export interface ProgressServiceDeps {
  repo: ProgressRepo
  /** Cheap model: the sweep and chat digests. */
  askSmall: AskModel
  /** The chat model: drafts and refreshes. */
  askChat: AskModel
  /** The Mail room's id. */
  mailRoom: () => string
  timeZone: () => string
  /** Tells the renderer a project's progress changed. */
  onChanged: (projectId: string) => void
  /** Runs before chats change room, so the rooms they leave keep what they earned. */
  beforeMove?: () => void
  /** Also tells the renderer chats moved room. */
  onChatsMoved?: () => void
  now?: () => Date
  log?: (message: string) => void
}

export function createProgressService(deps: ProgressServiceDeps) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  const today = (): string => localDayOf(now(), deps.timeZone())
  const running = new Set<string>()
  const folderProblems = new Map<string, string | null>()

  const ctx = () => ({ today: today(), now: now().toISOString(), newId: () => randomUUID() })

  function mustProject(projectId: string) {
    const project = repo.project(projectId)
    if (!project) throw new Error(`There is no project "${projectId}".`)
    return project
  }

  function get(projectId: string): ProjectProgress {
    const project = mustProject(projectId)
    const all = repo.milestones(projectId)
    const live = all.filter((m) => m.deletedAt === null).sort((a, b) => a.position - b.position)
    return {
      projectId,
      milestones: live,
      proposals: repo.proposals(projectId).filter((p) => p.answered === null),
      progress: progressOf(all),
      folder: project.folder,
      folderSource: project.folderSource,
      folderProblem: folderProblems.get(projectId) ?? null,
      sweptAt: project.sweptAt,
      running: running.has(projectId)
    }
  }

  async function ask<T>(model: AskModel, prompt: string, system: string, schema: Record<string, unknown>, parse: (v: unknown) => { success: true; data: T } | { success: false }): Promise<T> {
    const answer = await model(prompt, system, schema)
    if (!answer.ok) throw new Error(`Building progress failed: ${answer.error}`)
    const parsed = parse(answer.value)
    if (!parsed.success) throw new Error('Building progress failed: the answer did not match the expected shape.')
    return parsed.data
  }

  async function detectAndStoreFolder(projectId: string): Promise<void> {
    const project = mustProject(projectId)
    if (project.folderSource === 'user') return
    const files = repo.editedFiles(repo.linkedChatIds(projectId))
    if (files.length === 0) return
    const roots = new Map<string, string | null>()
    const facts: EditFact[] = []
    for (const f of files) {
      const dir = normPath(dirname(f.path)).toLowerCase()
      if (!roots.has(dir)) roots.set(dir, await gitRootOf(dirname(f.path)))
      facts.push({ path: f.path, edits: f.edits, gitRoot: roots.get(dir) ?? null })
    }
    const shared = new Set<string>()
    for (const root of new Set(facts.flatMap((f) => (f.gitRoot ? [f.gitRoot] : [])))) if (await isSharedRoot(root)) shared.add(root.toLowerCase())
    const found = detectFolder(facts, (root) => shared.has(root.toLowerCase()))
    if (found) repo.setFolder(projectId, found.folder, found.gitRoot, 'detected')
  }

  /** Digests for linked chats that have none, or have newer messages. Saved one by one, so a failure keeps the rest. */
  async function digestsFor(projectId: string): Promise<Array<{ chatId: string; title: string; digest: ChatDigest }>> {
    const chatIds = repo.linkedChatIds(projectId)
    const titles = repo.chatTitles(chatIds)
    const out: Array<{ chatId: string; title: string; digest: ChatDigest }> = []
    for (const chatId of chatIds) {
      const msgs = repo.chatMessages(chatId)
      if (msgs.length === 0) continue
      const last = msgs[msgs.length - 1]!.createdAt
      let stored = repo.digest(chatId)
      if (!stored || stored.throughMessageAt < last) {
        const raw = await ask(
          deps.askSmall,
          buildDigestPrompt({
            title: titles.get(chatId) ?? '',
            messages: msgs.map((m) => ({ role: m.role, content: m.content, day: m.localDay ?? localDayOf(m.createdAt, deps.timeZone()) }))
          }),
          DIGEST_SYSTEM_PROMPT,
          DIGEST_JSON_SCHEMA,
          (v) => digestSchema.safeParse(v)
        )
        const digest = interpretDigest(raw)
        repo.saveDigest(chatId, digest, last)
        stored = { digest, throughMessageAt: last }
      }
      out.push({ chatId, title: titles.get(chatId) ?? '', digest: stored.digest })
    }
    return out.sort((a, b) => (a.digest.done[0]?.day ?? '9999').localeCompare(b.digest.done[0]?.day ?? '9999'))
  }

  async function evidenceFor(projectId: string): Promise<Evidence> {
    const project = mustProject(projectId)
    if (!project.folder || !project.gitRoot) {
      folderProblems.set(projectId, null)
      return { commits: [], checkboxes: [], problem: null }
    }
    const shared = normPath(project.folder).toLowerCase() !== normPath(project.gitRoot).toLowerCase()
    const name = normPath(project.folder).split('/').pop() ?? ''
    const evidence = await readEvidence(project.folder, project.gitRoot, shared, [name, project.title])
    folderProblems.set(projectId, evidence.problem)
    return evidence
  }

  const knownOf = (evidence: Evidence, chatIds: string[]): KnownEvidence => ({
    commitHashes: new Set(evidence.commits.map((c) => c.hash)),
    checkboxRefs: new Set(evidence.checkboxes.map((b) => `${b.file}:${b.line}`)),
    chatIds: new Set(chatIds)
  })

  /** Runs `work` unless the project already has a run going; either way returns the progress after. */
  async function once(projectId: string, work: () => Promise<void>): Promise<ProjectProgress> {
    mustProject(projectId)
    if (running.has(projectId)) return get(projectId)
    running.add(projectId)
    deps.onChanged(projectId)
    try {
      await work()
    } finally {
      running.delete(projectId)
      deps.onChanged(projectId)
    }
    return get(projectId)
  }

  async function refreshWork(projectId: string): Promise<void> {
    const project = mustProject(projectId)
    const digests = await digestsFor(projectId)
    const evidence = await evidenceFor(projectId)
    const all = repo.milestones(projectId)
    const live = all.filter((m) => m.deletedAt === null).sort((a, b) => a.position - b.position)
    const raw = await ask(
      deps.askChat,
      buildRefreshPrompt({ title: project.title, milestones: live, digests, commits: evidence.commits, checkboxes: evidence.checkboxes }),
      REFRESH_SYSTEM_PROMPT,
      REFRESH_JSON_SCHEMA,
      (v) => refreshSchema.safeParse(v)
    )
    const fresh = interpretRefresh(raw, { ...knownOf(evidence, digests.map((d) => d.chatId)), milestoneIds: new Set(live.map((m) => m.id)) })
    // Read again: the person may have edited while the model was thinking.
    repo.transaction(() => repo.addProposals(projectId, filterProposals(fresh, repo.milestones(projectId), repo.proposals(projectId))))
  }

  function refresh(projectId: string): Promise<ProjectProgress> {
    return once(projectId, () => refreshWork(projectId))
  }

  return {
    get,

    /** Chats the model thinks belong to the project, for the person to confirm. Only chats newer than the last sweep. */
    async sweep(projectId: string): Promise<SweepCandidate[]> {
      const project = mustProject(projectId)
      const startedAt = now().toISOString()
      const rooms = [...new Set([project.roomId, deps.mailRoom()])]
      const candidates = repo.sweepCandidates(projectId, rooms, project.sweptAt)
      const linkedIds = repo.linkedChatIds(projectId)
      const linkedFirst = repo.firstMessages(linkedIds)
      const linkedTitles = repo.chatTitles(linkedIds)
      const linked = linkedIds.map((id) => ({ title: linkedTitles.get(id) ?? '', firstMessage: linkedFirst.get(id) ?? '' }))
      const found: SweepCandidate[] = []
      for (let i = 0; i < candidates.length; i += SWEEP_BATCH) {
        const batch = candidates.slice(i, i + SWEEP_BATCH)
        const first = repo.firstMessages(batch.map((c) => c.id))
        const asked = batch.map((c) => ({ id: c.id, title: c.title, firstMessage: first.get(c.id) ?? '' }))
        const raw = await ask(deps.askSmall, buildSweepPrompt({ project, linked, candidates: asked }), SWEEP_SYSTEM_PROMPT, SWEEP_JSON_SCHEMA, (v) => sweepSchema.safeParse(v))
        const ids = new Set(interpretSweep(raw, asked.map((c) => c.id)))
        found.push(...asked.filter((c) => ids.has(c.id)))
      }
      repo.setSweptAt(projectId, startedAt)
      return found
    },

    async link(projectId: string, accept: string[], dismiss: string[]): Promise<ProjectProgress> {
      const project = mustProject(projectId)
      if (accept.length > 0) deps.beforeMove?.()
      repo.transaction(() => repo.link(projectId, project.roomId, accept, dismiss))
      if (accept.length > 0) deps.onChatsMoved?.()
      await detectAndStoreFolder(projectId).catch((error) => log(`folder detection for ${projectId} failed: ${String(error)}`))
      deps.onChanged(projectId)
      return get(projectId)
    },

    /** The first draft writes milestones; with milestones already there it is a refresh. */
    build(projectId: string): Promise<ProjectProgress> {
      return once(projectId, async () => {
        const project = mustProject(projectId)
        if (!project.folder && project.folderSource !== 'user') await detectAndStoreFolder(projectId).catch(() => {})
        if (repo.milestones(projectId).length > 0) return refreshWork(projectId)
        const digests = await digestsFor(projectId)
        const evidence = await evidenceFor(projectId)
        const raw = await ask(
          deps.askChat,
          buildDraftPrompt({ title: project.title, digests, commits: evidence.commits, checkboxes: evidence.checkboxes }),
          DRAFT_SYSTEM_PROMPT,
          DRAFT_JSON_SCHEMA,
          (v) => draftSchema.safeParse(v)
        )
        const drafted = interpretDraft(raw, knownOf(evidence, digests.map((d) => d.chatId)))
        repo.transaction(() => {
          // Someone may have added milestones by hand meanwhile: then the draft is not written.
          if (repo.milestones(projectId).length > 0) return
          const list: Milestone[] = drafted.map((m, i) => ({ ...m, id: randomUUID(), originalTitle: m.title, position: i, edited: false, statusByUser: false, deletedAt: null }))
          repo.saveMilestones(projectId, list)
        })
      })
    },

    refresh,

    edit(projectId: string, edit: MilestoneEdit): ProjectProgress {
      repo.transaction(() => repo.saveMilestones(projectId, applyEdit(repo.milestones(projectId), edit, ctx())))
      deps.onChanged(projectId)
      return get(projectId)
    },

    answer(proposalId: string, accept: boolean): ProjectProgress {
      const proposal = repo.proposal(proposalId)
      if (!proposal) throw new Error(`There is no proposal "${proposalId}".`)
      repo.transaction(() => {
        if (proposal.answered !== null) return
        if (accept) repo.saveMilestones(proposal.projectId, acceptProposal(repo.milestones(proposal.projectId), proposal, ctx()))
        repo.answerProposal(proposalId, accept ? 'accepted' : 'dismissed')
      })
      deps.onChanged(proposal.projectId)
      return get(proposal.projectId)
    },

    /** Sets the folder by hand (its git root found), or clears it; detection never replaces either. */
    async setFolder(projectId: string, folder: string | null): Promise<ProjectProgress> {
      mustProject(projectId)
      if (folder === null) repo.setFolder(projectId, null, null, 'user')
      else {
        const root = await gitRootOf(folder)
        repo.setFolder(projectId, normPath(folder), root ?? normPath(folder), 'user')
        folderProblems.set(projectId, root ? null : 'The folder is not a git repository, so commits were not read.')
      }
      deps.onChanged(projectId)
      return get(projectId)
    },

    detectAndStoreFolder,

    /** A linked chat went quiet: projects that already have milestones get a refresh (proposals only). */
    afterChatQuiet(chatId: string): void {
      for (const projectId of repo.projectsOfChat(chatId)) {
        if (repo.milestones(projectId).length === 0) continue
        void refresh(projectId).catch((error: unknown) => log(`refresh of ${projectId} failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }
}

export type ProgressService = ReturnType<typeof createProgressService>
