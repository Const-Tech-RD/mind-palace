/**
 * The model calls behind project progress, pure: what to send and how to read
 * the answer. `askJson` (src/main/chat/claude.ts) makes the calls.
 *
 *  - Sweep: which of a batch of chats belong to a project.
 *  - Digest: one chat, summed up as what was done (by day) and what was planned.
 *  - Draft: a project's first milestones, from its digests and repo evidence.
 *  - Refresh: proposals against the current milestones, never edits.
 *
 * Empty strings stand for "none" in the answers (`done_on`, `evidence_ref`,
 * `milestone_id`, `after_id`), so every field is a plain string.
 */
import { z } from 'zod'
import { foldTitle, MILESTONE_TITLE_MAX, type Evidence, type FreshProposal, type Milestone } from './milestones'
import type { Checkbox, Commit } from './repoEvidence'
import type { AreaChat } from './roomPrompts'

const MAX_TEXT = 300
const clip = (text: string, limit = MAX_TEXT): string => (text.length <= limit ? text : `${text.slice(0, limit)} […]`)
const DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (value: string): string | null => (DAY.test(value.trim()) ? value.trim() : null)
const str = { type: 'string' } as const

// --- Sweep ---------------------------------------------------------------------

/** Chats per sweep call. */
export const SWEEP_BATCH = 60

export const sweepSchema = z.object({ chat_ids: z.array(z.string()) })
export const SWEEP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chat_ids'],
  properties: { chat_ids: { type: 'array', items: str } }
} as const

export const SWEEP_SYSTEM_PROMPT = [
  'You find the chats that belong to one of a person\'s projects.',
  'A chat belongs when it is about building, planning, fixing or deciding something for that project, not when it only shares a topic with it.',
  'Answer with the JSON object only.'
].join(' ')

export function buildSweepPrompt(input: { project: { title: string }; linked: AreaChat[]; candidates: Array<{ id: string } & AreaChat> }): string {
  const linked = input.linked.length === 0 ? 'None yet.' : input.linked.map((c) => `- ${clip(c.title, 80)}: ${clip(c.firstMessage)}`).join('\n')
  const candidates = input.candidates.map((c) => `- ${c.id} · ${clip(c.title, 80)}: ${clip(c.firstMessage)}`).join('\n')
  return [
    `## The project: ${input.project.title}`,
    '## Chats already known to be about it',
    linked,
    '## Chats to sort',
    candidates,
    '## Your answer',
    '- chat_ids: the ids of the chats above that belong to this project. Leave out anything unsure.'
  ].join('\n\n')
}

export function interpretSweep(raw: z.infer<typeof sweepSchema>, candidateIds: readonly string[]): string[] {
  const asked = new Set(candidateIds)
  return [...new Set(raw.chat_ids.filter((id) => asked.has(id)))]
}

// --- Digest --------------------------------------------------------------------

/** Characters of a chat sent for its digest; longer chats keep their newest messages. */
export const DIGEST_INPUT_MAX = 40_000

export interface ChatDigest {
  done: Array<{ item: string; day: string }>
  planned: string[]
}

export const digestSchema = z.object({
  done: z.array(z.object({ item: z.string(), day: z.string() })),
  planned: z.array(z.string())
})
export const DIGEST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['done', 'planned'],
  properties: {
    done: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'day'], properties: { item: str, day: str } } },
    planned: { type: 'array', items: str }
  }
} as const

export const DIGEST_SYSTEM_PROMPT = [
  'You sum up one chat between a person and Claude for a progress tracker.',
  'List what actually got done in it (built, fixed, shipped, decided), each with the day it happened, and what was planned but not done yet.',
  'Short items, a few words each. Leave out small talk and explanations. Answer with the JSON object only.'
].join(' ')

export function buildDigestPrompt(input: { title: string; messages: Array<{ role: string; content: string; day: string }> }): string {
  const lines = input.messages.map((m) => `[${m.day}] ${m.role === 'user' ? 'Person' : 'Claude'}: ${m.content}`)
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (size + line.length + 1 > DIGEST_INPUT_MAX) break
    kept.unshift(line)
    size += line.length + 1
  }
  const left = lines.length - kept.length
  return [
    `## The chat: ${clip(input.title, 120)}`,
    left > 0 ? `(${left} earlier messages left out; the newest are below.)` : '',
    kept.join('\n'),
    '## Your answer',
    '- done: what got done, each { item, day } with day as YYYY-MM-DD from the messages.\n- planned: what was planned and is not done yet.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function interpretDigest(raw: z.infer<typeof digestSchema>): ChatDigest {
  return {
    done: raw.done.flatMap((d) => {
      const when = day(d.day)
      const item = d.item.trim()
      return when && item ? [{ item, day: when }] : []
    }),
    planned: raw.planned.map((p) => p.trim()).filter(Boolean)
  }
}

// --- Evidence, shared by the draft and the refresh -----------------------------

export interface KnownEvidence {
  /** Short hash from the git log → its day. */
  commits: Map<string, string>
  /** `file:line` of each plan checkbox → whether it is ticked. */
  checkboxes: Map<string, boolean>
  chatIds: Set<string>
}

const MODEL_EVIDENCE = ['commit', 'plan', 'chat'] as const
const evidenceEnum = z.enum(MODEL_EVIDENCE)

/**
 * Evidence the model cited, checked against what was sent: anything not found
 * becomes chat evidence without a reference. A plan box backs a done claim
 * only when it is ticked. A commit also gives its day.
 */
function checkEvidence(
  kind: (typeof MODEL_EVIDENCE)[number],
  ref: string,
  known: KnownEvidence,
  claimsDone: boolean
): { evidence: Evidence; evidenceRef: string | null; day: string | null } {
  const r = ref.trim()
  if (kind === 'commit' && r.length >= 7) {
    for (const [hash, when] of known.commits) if (r.startsWith(hash) || hash.startsWith(r)) return { evidence: 'commit', evidenceRef: hash, day: when }
  }
  if (kind === 'plan' && known.checkboxes.has(r) && (!claimsDone || known.checkboxes.get(r))) return { evidence: 'plan', evidenceRef: r, day: null }
  return { evidence: 'chat', evidenceRef: known.chatIds.has(r) ? r : null, day: null }
}

/** Characters of evidence (chats, commits, plan boxes) sent to a draft or refresh. */
export const EVIDENCE_INPUT_MAX = 80_000

/** Lines in order until `max` characters; how many were left out. */
function fit(lines: string[], max: number): { text: string; left: number } {
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    if (size + line.length + 1 > max) break
    kept.push(line)
    size += line.length + 1
  }
  return { text: kept.join('\n'), left: lines.length - kept.length }
}

function evidenceSection(input: { digests: Array<{ chatId: string; title: string; digest: ChatDigest }>; commits: Commit[]; checkboxes: Checkbox[] }): string {
  // Commits and plan boxes get a fixed share; chats get the rest. Whatever doesn't fit is named, not silently dropped.
  const commits = fit(input.commits.map((c) => `- ${c.hash} ${c.day} ${clip(c.subject, 120)}`), EVIDENCE_INPUT_MAX * 0.2)
  const boxes = fit(input.checkboxes.map((b) => `- ${b.file}:${b.line} [${b.done ? 'x' : ' '}] ${clip(b.text, 120)}`), EVIDENCE_INPUT_MAX * 0.25)
  const chatBlocks = input.digests.map((d) =>
    [
      `### ${d.chatId} · ${clip(d.title, 80)}`,
      ...d.digest.done.slice(0, 15).map((x) => `- done ${x.day}: ${clip(x.item, 160)}`),
      ...d.digest.planned.slice(0, 10).map((x) => `- planned: ${clip(x, 160)}`)
    ].join('\n')
  )
  const chats = fit(chatBlocks, EVIDENCE_INPUT_MAX - commits.text.length - boxes.text.length)
  const section = (text: string, left: number, what: string): string =>
    text === '' && left === 0 ? 'None.' : `${text}${left > 0 ? `\n(${left} more ${what} left out to keep this short.)` : ''}`
  return [
    '## Chats (by id)',
    section(chats.text, chats.left, 'chats'),
    '## Commits (short hash, day, subject)',
    section(commits.text, commits.left, 'commits'),
    '## Plan checkboxes (file:line)',
    section(boxes.text, boxes.left, 'checkboxes')
  ].join('\n\n')
}

const MILESTONE_RULES = [
  'A milestone is a meaningful step of the project, something a person would tell a friend they finished (a feature working, a deploy, a decision made), not a single commit or a small fix.',
  'Evidence: cite a commit by its short hash or a plan checkbox by file:line when one shows the step is done; otherwise cite the chat id it comes from. Only cite what is listed.'
].join(' ')

// --- Draft ---------------------------------------------------------------------

export const MAX_DRAFT_MILESTONES = 20

const rowSchema = z.object({ title: z.string(), status: z.enum(['done', 'planned']), done_on: z.string(), evidence: evidenceEnum, evidence_ref: z.string() })
export const draftSchema = z.object({ milestones: z.array(rowSchema) })
export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['milestones'],
  properties: {
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'status', 'done_on', 'evidence', 'evidence_ref'],
        properties: {
          title: str,
          status: { type: 'string', enum: ['done', 'planned'] },
          done_on: str,
          evidence: { type: 'string', enum: [...MODEL_EVIDENCE] },
          evidence_ref: str
        }
      }
    }
  }
} as const

export const DRAFT_SYSTEM_PROMPT = [
  'You lay out a project\'s milestones for a progress tracker, from summaries of its chats and, when there is one, its repository.',
  MILESTONE_RULES,
  `Give 3 to ${MAX_DRAFT_MILESTONES} milestones in the order they happen: done ones first by day, then planned ones in the order they would be done.`,
  'Answer with the JSON object only.'
].join(' ')

export type DraftedMilestone = Pick<Milestone, 'title' | 'status' | 'doneOn' | 'evidence' | 'evidenceRef'>

export function buildDraftPrompt(input: { title: string; digests: Array<{ chatId: string; title: string; digest: ChatDigest }>; commits: Commit[]; checkboxes: Checkbox[] }): string {
  return [
    `## The project: ${input.title}`,
    evidenceSection(input),
    '## Your answer',
    '- milestones: each { title (a few words), status (done or planned), done_on (YYYY-MM-DD for done ones, else ""), evidence (commit, plan or chat), evidence_ref (the hash, file:line or chat id) }.'
  ].join('\n\n')
}

function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, MILESTONE_TITLE_MAX)
}

export function interpretDraft(raw: z.infer<typeof draftSchema>, known: KnownEvidence): DraftedMilestone[] {
  const seen = new Set<string>()
  const out: DraftedMilestone[] = []
  for (const m of raw.milestones) {
    const title = cleanTitle(m.title)
    const key = foldTitle(title)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    const { day: commitDay, ...evidence } = checkEvidence(m.evidence, m.evidence_ref, known, m.status === 'done')
    out.push({ title, status: m.status, doneOn: m.status === 'done' ? (day(m.done_on) ?? commitDay) : null, ...evidence })
    if (out.length === MAX_DRAFT_MILESTONES) break
  }
  return out
}

// --- Refresh -------------------------------------------------------------------

const proposalSchema = z.object({
  kind: z.enum(['add', 'tick']),
  milestone_id: z.string(),
  title: z.string(),
  after_id: z.string(),
  evidence: evidenceEnum,
  evidence_ref: z.string(),
  done_on: z.string()
})
export const refreshSchema = z.object({ proposals: z.array(proposalSchema) })
export const REFRESH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'milestone_id', 'title', 'after_id', 'evidence', 'evidence_ref', 'done_on'],
        properties: {
          kind: { type: 'string', enum: ['add', 'tick'] },
          milestone_id: str,
          title: str,
          after_id: str,
          evidence: { type: 'string', enum: [...MODEL_EVIDENCE] },
          evidence_ref: str,
          done_on: str
        }
      }
    }
  }
} as const

export const REFRESH_SYSTEM_PROMPT = [
  'You keep a project\'s milestones up to date for a progress tracker. You never change them: you only propose.',
  MILESTONE_RULES,
  'Propose ticking a planned milestone when the evidence shows it is done, and adding a milestone only for a meaningful step that is missing.',
  'Leave alone anything the person edited. Propose nothing when nothing changed. Answer with the JSON object only.'
].join(' ')

export function buildRefreshPrompt(input: {
  title: string
  milestones: Milestone[]
  digests: Array<{ chatId: string; title: string; digest: ChatDigest }>
  commits: Commit[]
  checkboxes: Checkbox[]
}): string {
  const current =
    input.milestones.length === 0
      ? 'None.'
      : input.milestones
          .map((m) => `- ${m.id} · ${m.status}${m.doneOn ? ` ${m.doneOn}` : ''} · ${m.title}${m.edited ? ' (edited by the person: leave it alone)' : ''}`)
          .join('\n')
  return [
    `## The project: ${input.title}`,
    '## Milestones now (id · status · title)',
    current,
    evidenceSection(input),
    '## Your answer',
    [
      '- proposals: each { kind, milestone_id, title, after_id, evidence, evidence_ref, done_on }.',
      '- kind "tick": a planned milestone the evidence shows is done; milestone_id is its id, title its title, done_on the day, after_id "".',
      '- kind "add": a missing meaningful step; milestone_id "", after_id the id it comes after ("" for the end), done_on its day if already done, else "".'
    ].join('\n')
  ].join('\n\n')
}

export function interpretRefresh(raw: z.infer<typeof refreshSchema>, known: KnownEvidence & { milestoneIds: Set<string> }): FreshProposal[] {
  const out: FreshProposal[] = []
  for (const p of raw.proposals) {
    const title = cleanTitle(p.title)
    if (title === '') continue
    const doneDay = day(p.done_on)
    const { day: commitDay, ...evidence } = checkEvidence(p.evidence, p.evidence_ref, known, p.kind === 'tick' || doneDay !== null)
    if (p.kind === 'tick') {
      if (!known.milestoneIds.has(p.milestone_id)) continue
      out.push({ kind: 'tick', milestoneId: p.milestone_id, title, afterId: null, ...evidence, doneOn: doneDay ?? commitDay })
    } else {
      out.push({ kind: 'add', milestoneId: null, title, afterId: known.milestoneIds.has(p.after_id) ? p.after_id : null, ...evidence, doneOn: doneDay })
    }
  }
  return out
}
