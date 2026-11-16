/** Scoring for the classifier eval (`npm run eval`). Pure. */

export interface EvalCase {
  /** The first two user messages of a real chat. */
  messages: string[]
  room_id: string
  is_project: boolean
  /** The area of life a person would file it under; only the grouping is scored, not the name. */
  area: string
}

export interface EvalOutcome {
  file: string
  line: number
  expected: EvalCase
  /** Null when the classifier call itself failed. */
  got: { roomId: string; isProject: boolean; confidence: number; area: string | null } | null
  error?: string
}

export interface EvalScore {
  total: number
  failedCalls: number
  /** Share of cases placed in the expected room. Failed calls count as wrong. */
  roomAccuracy: number
  /** Of the chats flagged as projects, the share that really were. Null when none were flagged. */
  projectPrecision: number | null
  /** Of the real projects, the share that were flagged. Null when there were none. */
  projectRecall: number | null
  wrongRoom: EvalOutcome[]
  wrongProject: EvalOutcome[]
}

export const ROOM_ACCURACY_TARGET = 0.85
export const PROJECT_PRECISION_TARGET = 0.7

export function parseEvalLine(text: string): EvalCase {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null) throw new Error('expected a JSON object')
  const { messages, room_id, is_project, area } = value as Record<string, unknown>
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every((m) => typeof m === 'string' && m.trim() !== '')) {
    throw new Error('"messages" must be a non-empty array of strings')
  }
  if (typeof room_id !== 'string' || room_id === '') throw new Error('"room_id" must be a string')
  if (typeof is_project !== 'boolean') throw new Error('"is_project" must be true or false')
  if (typeof area !== 'string' || area === '') throw new Error('"area" must be a string')
  return { messages: messages as string[], room_id, is_project, area }
}

export function scoreEval(outcomes: readonly EvalOutcome[]): EvalScore {
  let rightRoom = 0
  let flagged = 0
  let flaggedRight = 0
  let real = 0
  const wrongRoom: EvalOutcome[] = []
  const wrongProject: EvalOutcome[] = []

  for (const outcome of outcomes) {
    if (outcome.expected.is_project) real++
    if (outcome.got === null) {
      wrongRoom.push(outcome)
      if (outcome.expected.is_project) wrongProject.push(outcome)
      continue
    }
    if (outcome.got.roomId === outcome.expected.room_id) rightRoom++
    else wrongRoom.push(outcome)
    if (outcome.got.isProject) {
      flagged++
      if (outcome.expected.is_project) flaggedRight++
    }
    if (outcome.got.isProject !== outcome.expected.is_project) wrongProject.push(outcome)
  }

  return {
    total: outcomes.length,
    failedCalls: outcomes.filter((o) => o.got === null).length,
    roomAccuracy: outcomes.length === 0 ? 0 : rightRoom / outcomes.length,
    projectPrecision: flagged === 0 ? null : flaggedRight / flagged,
    projectRecall: real === 0 ? null : flaggedRight / real,
    wrongRoom,
    wrongProject
  }
}

/**
 * How well the model groups chats into areas, whatever it names them: the
 * share of case pairs where "same labelled area" matches "same model area".
 * A failed call (or no area) disagrees with every pair it is in. Null with
 * fewer than two cases.
 */
export function areaAgreement(outcomes: readonly EvalOutcome[]): number | null {
  if (outcomes.length < 2) return null
  let pairs = 0
  let agree = 0
  for (let i = 0; i < outcomes.length; i++) {
    for (let j = i + 1; j < outcomes.length; j++) {
      pairs++
      const a = outcomes[i]!
      const b = outcomes[j]!
      if (!a.got?.area || !b.got?.area) continue
      if ((a.expected.area === b.expected.area) === (a.got.area === b.got.area)) agree++
    }
  }
  return agree / pairs
}
