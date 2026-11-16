/**
 * A project's milestones and the rules that protect the person's edits. Pure.
 *
 * The first draft writes milestones; after that the model only proposes. Any
 * hand change marks a milestone `edited`; a hand tick or untick also marks
 * `statusByUser`, after which no tick is proposed for it. Deleted milestones
 * stay as tombstones and renamed ones keep `originalTitle`, so a refresh can
 * never bring either back.
 */
import { areaKey } from './classify'

export type Evidence = 'commit' | 'plan' | 'chat' | 'user'
export type MilestoneStatus = 'done' | 'planned'

export interface Milestone {
  id: string
  title: string
  originalTitle: string
  /** Order among live milestones, 0-based. */
  position: number
  status: MilestoneStatus
  /** `YYYY-MM-DD` it happened, for done ones. */
  doneOn: string | null
  evidence: Evidence
  /** Commit short hash, `file:line` of a plan checkbox, or a chat id. */
  evidenceRef: string | null
  edited: boolean
  statusByUser: boolean
  deletedAt: string | null
}

export interface Proposal {
  id: string
  kind: 'add' | 'tick'
  /** The milestone a tick is for. */
  milestoneId: string | null
  title: string
  /** Where an add goes: after this milestone, or at the end. */
  afterId: string | null
  evidence: Evidence
  evidenceRef: string | null
  doneOn: string | null
  answered: 'accepted' | 'dismissed' | null
}

export type FreshProposal = Omit<Proposal, 'id' | 'answered'>

export type MilestoneEdit =
  | { kind: 'tick'; id: string; done: boolean; doneOn?: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'move'; id: string; toIndex: number }
  | { kind: 'add'; title: string; afterId: string | null }
  | { kind: 'delete'; id: string }

export interface EditContext {
  /** `YYYY-MM-DD` in the settings timezone. */
  today: string
  /** ISO instant, for tombstones. */
  now: string
  newId: () => string
}

export interface ProjectProgress {
  projectId: string
  /** Live milestones, in order. */
  milestones: Milestone[]
  /** Proposals waiting for an answer. */
  proposals: Proposal[]
  progress: { done: number; total: number } | null
  folder: string | null
  folderSource: 'detected' | 'user' | null
  /** Why the folder could not be read (gone, not a repo, no git); progress then comes from chats alone. */
  folderProblem: string | null
  sweptAt: string | null
  /** A build or refresh is running for this project. */
  running: boolean
}

/** A chat the sweep thinks belongs to a project, for the person to confirm. */
export interface SweepCandidate {
  id: string
  title: string
  firstMessage: string
}

export const MILESTONE_TITLE_MAX = 80

/** Titles compared as the same: case, accents and punctuation ignored. */
export const foldTitle = (title: string): string => areaKey(title)

const isLive = (m: Milestone): boolean => m.deletedAt === null
const ordered = (list: Milestone[]): Milestone[] => list.filter(isLive).sort((a, b) => a.position - b.position)

function cleanTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, ' ')
  if (trimmed === '') throw new Error('A milestone needs a title.')
  return trimmed.slice(0, MILESTONE_TITLE_MAX)
}

/** The whole list again, with live milestones numbered 0..n-1 in `order`. */
function renumber(list: Milestone[], order: Milestone[]): Milestone[] {
  const position = new Map(order.map((m, i) => [m.id, i]))
  return list.map((m) => (position.has(m.id) ? { ...m, position: position.get(m.id)! } : m))
}

function insertAfter(list: Milestone[], item: Milestone, afterId: string | null): Milestone[] {
  const order = ordered(list)
  const at = afterId === null ? -1 : order.findIndex((m) => m.id === afterId)
  order.splice(at === -1 ? order.length : at + 1, 0, item)
  return renumber([...list, item], order)
}

function update(list: Milestone[], id: string, change: (m: Milestone) => Milestone): Milestone[] {
  if (!list.some((m) => m.id === id && isLive(m))) throw new Error(`There is no milestone "${id}".`)
  return list.map((m) => (m.id === id ? change(m) : m))
}

/** A hand edit. Returns every milestone (tombstones included), live ones renumbered. */
export function applyEdit(list: Milestone[], edit: MilestoneEdit, ctx: EditContext): Milestone[] {
  switch (edit.kind) {
    case 'tick':
      return update(list, edit.id, (m) =>
        edit.done
          ? { ...m, status: 'done', doneOn: edit.doneOn ?? ctx.today, evidence: 'user', evidenceRef: null, edited: true, statusByUser: true }
          : { ...m, status: 'planned', doneOn: null, edited: true, statusByUser: true }
      )
    case 'rename': {
      const title = cleanTitle(edit.title)
      return update(list, edit.id, (m) => ({ ...m, title, edited: true }))
    }
    case 'move': {
      const order = ordered(update(list, edit.id, (m) => m))
      const from = order.findIndex((m) => m.id === edit.id)
      const [moving] = order.splice(from, 1)
      order.splice(Math.max(0, Math.min(edit.toIndex, order.length)), 0, { ...moving!, edited: true })
      return renumber(
        list.map((m) => (m.id === edit.id ? { ...m, edited: true } : m)),
        order
      )
    }
    case 'add': {
      const title = cleanTitle(edit.title)
      const item: Milestone = {
        id: ctx.newId(),
        title,
        originalTitle: title,
        position: 0,
        status: 'planned',
        doneOn: null,
        evidence: 'user',
        evidenceRef: null,
        edited: true,
        statusByUser: false,
        deletedAt: null
      }
      return insertAfter(list, item, edit.afterId)
    }
    case 'delete': {
      const next = update(list, edit.id, (m) => ({ ...m, deletedAt: ctx.now, edited: true }))
      return renumber(next, ordered(next))
    }
  }
}

/**
 * The fresh proposals worth showing. Adds are dropped when their title is any
 * milestone's current or original title (deleted ones too), a dismissed add's,
 * or one still waiting. Ticks are dropped for a milestone that is gone, done,
 * or whose status the person set, when one is already waiting, or when the
 * same evidence for it was dismissed before.
 */
export function filterProposals(fresh: FreshProposal[], milestones: Milestone[], past: Proposal[]): FreshProposal[] {
  const takenTitles = new Set<string>()
  for (const m of milestones) {
    takenTitles.add(foldTitle(m.title))
    takenTitles.add(foldTitle(m.originalTitle))
  }
  for (const p of past) if (p.kind === 'add' && p.answered !== 'accepted') takenTitles.add(foldTitle(p.title))
  const byId = new Map(milestones.map((m) => [m.id, m]))
  const tickKey = (p: { milestoneId: string | null; evidence: Evidence; evidenceRef: string | null }): string =>
    `${p.milestoneId}|${p.evidence}|${p.evidenceRef ?? ''}`
  const dismissedTicks = new Set(past.filter((p) => p.kind === 'tick' && p.answered === 'dismissed').map(tickKey))
  const ticked = new Set(past.filter((p) => p.kind === 'tick' && p.answered === null).map((p) => p.milestoneId))

  const kept: FreshProposal[] = []
  for (const p of fresh) {
    if (p.kind === 'add') {
      const key = foldTitle(p.title)
      if (key === '' || takenTitles.has(key)) continue
      takenTitles.add(key)
      kept.push(p)
    } else {
      const m = p.milestoneId === null ? undefined : byId.get(p.milestoneId)
      if (!m || !isLive(m) || m.status === 'done' || m.statusByUser) continue
      if (ticked.has(m.id) || dismissedTicks.has(tickKey(p))) continue
      ticked.add(m.id)
      kept.push(p)
    }
  }
  return kept
}

/** Applies an accepted proposal. Model-made changes stay unedited, so they never block later proposals. */
export function acceptProposal(list: Milestone[], p: Proposal, ctx: EditContext): Milestone[] {
  if (p.kind === 'tick') {
    return update(list, p.milestoneId ?? '', (m) => ({ ...m, status: 'done', doneOn: p.doneOn ?? ctx.today, evidence: p.evidence, evidenceRef: p.evidenceRef }))
  }
  const title = cleanTitle(p.title)
  const item: Milestone = {
    id: ctx.newId(),
    title,
    originalTitle: title,
    position: 0,
    status: p.doneOn ? 'done' : 'planned',
    doneOn: p.doneOn,
    evidence: p.evidence,
    evidenceRef: p.evidenceRef,
    edited: false,
    statusByUser: false,
    deletedAt: null
  }
  return insertAfter(list, item, p.afterId)
}

/** Done out of all live milestones; null when there are none. */
export function progressOf(list: Milestone[]): { done: number; total: number } | null {
  const live = list.filter(isLive)
  if (live.length === 0) return null
  return { done: live.filter((m) => m.status === 'done').length, total: live.length }
}
