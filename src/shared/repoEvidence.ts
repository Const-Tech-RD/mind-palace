/**
 * Reading a project's repo as evidence: git history and plan checkboxes. Pure
 * parsers; src/main/progress/evidence.ts runs git and reads the files.
 */
import { areaKey } from './classify'

/** `git log` format: fields separated by tabs, since refs and subjects both hold spaces. */
export const GIT_LOG_FORMAT = '%h%x09%ad%x09%D%x09%s'

export interface Commit {
  hash: string
  /** `YYYY-MM-DD` (`--date=short`). */
  day: string
  /** Branch and tag names pointing at it, as git prints them; empty for most commits. */
  refs: string
  subject: string
}

export function parseGitLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const [hash, day, refs, ...rest] = line.split('\t')
    if (!hash || !day || refs === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    commits.push({ hash, day, refs, subject: rest.join('\t') })
  }
  return commits
}

export interface Checkbox {
  file: string
  /** 1-based. */
  line: number
  done: boolean
  text: string
}

const BOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/
const FENCE = /^\s*(```|~~~)/

/** Every Markdown task-list item in a file, outside code fences. */
export function parseCheckboxes(file: string, text: string): Checkbox[] {
  const boxes: Checkbox[] = []
  let fenced = false
  text.split(/\r?\n/).forEach((line, i) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    const m = BOX.exec(line)
    if (m) boxes.push({ file, line: i + 1, done: m[1] !== ' ', text: m[2]! })
  })
  return boxes
}

/** Lines of a plan read when deciding whether it is about a project. */
export const PLAN_HEAD_LINES = 40

const words = (text: string): Set<string> => new Set(areaKey(text).split('_').filter(Boolean))

/**
 * Whether a plan in a shared `docs/` is about this project: every word (3+
 * letters) of one of its names appears in the file name or the first 40 lines.
 */
export function planMentions(text: string, names: string[], fileName = ''): boolean {
  const head = text.split(/\r?\n/).slice(0, PLAN_HEAD_LINES).join('\n')
  const present = new Set([...words(head), ...words(fileName.replace(/^.*[\\/]/, ''))])
  return names.some((name) => {
    const needed = [...words(name)].filter((w) => w.length >= 3)
    return needed.length > 0 && needed.every((w) => present.has(w))
  })
}
