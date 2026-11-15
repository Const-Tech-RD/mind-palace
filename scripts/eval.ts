/**
 * Classifier eval: `npm run eval [files...]`.
 *
 * Reads `eval/*.jsonl` (or the files given), one chat per line:
 *   {"messages": ["first user message", "second user message"], "room_id": "coding", "is_project": false}
 * runs the real classifier over each, and prints room accuracy, project
 * precision and recall, and the lines it got wrong.
 *
 * It calls Claude through the local Claude Code login, so it uses plan limits.
 * `eval/` is git-ignored: the files hold real chats.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { loadCatalog } from '../src/main/catalog/loader'
import { askJson } from '../src/main/chat/claude'
import { classifyTranscript } from '../src/main/palace/classifier'
import {
  parseEvalLine,
  PROJECT_PRECISION_TARGET,
  ROOM_ACCURACY_TARGET,
  scoreEval,
  type EvalCase,
  type EvalOutcome
} from '../src/shared/evalMetrics'

const MODEL = process.env['MIND_PALACE_EVAL_MODEL'] ?? 'claude-haiku-5-5'
const CONCURRENCY = 4
const root = process.cwd()

function findFiles(): string[] {
  const given = process.argv.slice(2)
  if (given.length > 0) return given
  const dir = join(root, 'eval')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => join(dir, name))
}

function readCases(file: string): Array<{ file: string; line: number; expected: EvalCase }> {
  const cases: Array<{ file: string; line: number; expected: EvalCase }> = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      if (text.trim() === '') return
      try {
        cases.push({ file: relative(root, file), line: index + 1, expected: parseEvalLine(text) })
      } catch (error) {
        throw new Error(`${relative(root, file)}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  return cases
}

const percent = (value: number | null): string => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)
const preview = (text: string): string => (text.length > 90 ? `${text.slice(0, 90)}…` : text).replace(/\s+/g, ' ')

async function main(): Promise<void> {
  const files = findFiles()
  if (files.length === 0) {
    console.error(
      'No eval files. Put your labelled chats in eval/<name>.jsonl, one JSON object per line:\n' +
        '  {"messages": ["first user message", "second user message"], "room_id": "coding", "is_project": false}\n' +
        'or try the made-up sample: npm run eval -- scripts/eval-sample.jsonl'
    )
    process.exit(2)
  }

  const catalog = loadCatalog(join(root, 'catalog'))
  const rooms = Object.values(catalog.rooms).map(({ id, name, belongs, not_here, examples }) => ({
    id,
    name,
    belongs,
    not_here,
    examples
  }))
  const roomIds = new Set(rooms.map((room) => room.id))
  const cases = files.flatMap(readCases)
  for (const c of cases) {
    if (!roomIds.has(c.expected.room_id)) throw new Error(`${c.file}:${c.line}: unknown room_id "${c.expected.room_id}"`)
  }

  console.log(`Classifying ${cases.length} chats from ${files.length} file(s) with ${MODEL}…`)
  const outcomes: EvalOutcome[] = new Array(cases.length)
  let next = 0
  let tokens = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      const c = cases[index]
      if (!c) return
      const outcome = await classifyTranscript({
        rooms,
        fallbackRoomId: catalog.rules.classification.fallback_room,
        messages: c.expected.messages.map((content) => ({ role: 'user' as const, content })),
        openProjects: [],
        askModel: (prompt, system, schema) =>
          askJson({ prompt, system, schema, model: MODEL, cwd: tmpdir(), appVersion: 'eval' })
      })
      if (outcome.ok) {
        tokens += outcome.tokensIn + outcome.tokensOut
        outcomes[index] = {
          ...c,
          got: {
            roomId: outcome.result.roomId,
            isProject: outcome.result.project.kind !== 'none',
            confidence: outcome.result.confidence
          }
        }
      } else {
        outcomes[index] = { ...c, got: null, error: outcome.error }
      }
      process.stdout.write('.')
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  process.stdout.write('\n\n')

  const score = scoreEval(outcomes)
  console.log(`Room accuracy      ${percent(score.roomAccuracy)}   (target ${percent(ROOM_ACCURACY_TARGET)})`)
  console.log(`Project precision  ${percent(score.projectPrecision)}   (target above ${percent(PROJECT_PRECISION_TARGET)})`)
  console.log(`Project recall     ${percent(score.projectRecall)}`)
  console.log(`Tokens used        ${tokens}`)
  if (score.failedCalls > 0) console.log(`Failed calls       ${score.failedCalls}`)

  if (score.wrongRoom.length > 0) {
    console.log('\nWrong room:')
    for (const o of score.wrongRoom) {
      const got = o.got ? `${o.got.roomId} (${o.got.confidence.toFixed(2)})` : `failed: ${o.error}`
      console.log(`  ${o.file}:${o.line}  expected ${o.expected.room_id}, got ${got}\n    ${preview(o.expected.messages[0]!)}`)
    }
  }
  if (score.wrongProject.length > 0) {
    console.log('\nWrong project flag:')
    for (const o of score.wrongProject) {
      const got = o.got ? String(o.got.isProject) : 'failed'
      console.log(`  ${o.file}:${o.line}  expected ${o.expected.is_project}, got ${got}\n    ${preview(o.expected.messages[0]!)}`)
    }
  }

  const passed =
    score.failedCalls === 0 &&
    score.roomAccuracy >= ROOM_ACCURACY_TARGET &&
    (score.projectPrecision === null || score.projectPrecision > PROJECT_PRECISION_TARGET)
  console.log(passed ? '\nPASS' : '\nBELOW TARGET')
  process.exit(passed ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
})
