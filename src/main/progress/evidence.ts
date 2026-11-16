/**
 * Read-only looks at a project's folder: its git root, whether that root holds
 * several projects, the git history and the plan checkboxes. Nothing here
 * throws; a folder that is gone, isn't a repo, or a missing git gives empty
 * evidence and a `problem` to show.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { isManifest, normPath } from '@shared/folders'
import type { GitInfo } from '@shared/milestones'
import { GIT_LOG_FORMAT, parseCheckboxes, parseGitLog, planMentions, type Checkbox, type Commit } from '@shared/repoEvidence'

const GIT_TIMEOUT_MS = 15_000
/** Plan files read per project, newest first. */
const MAX_PLAN_FILES = 20
/** Markdown files looked at while walking a folder, so a huge tree can't stall the app. */
const MAX_MARKDOWN_SEEN = 2_000
const MAX_PLAN_BYTES = 512 * 1024

function git(args: string[], cwd: string, timeout = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  })
}

/** Seconds a git call for the project page may take. */
const GIT_INFO_TIMEOUT_MS = 5_000

/**
 * The folder's branch, newest commit and uncommitted file count, for the
 * project page. Read-only: `--no-optional-locks` keeps `git status` from
 * refreshing the index. Null when the folder isn't a repo, is gone, or git is missing.
 */
export async function readGitInfo(folder: string): Promise<GitInfo | null> {
  try {
    const [branch, last, status] = await Promise.all([
      git(['--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'], folder, GIT_INFO_TIMEOUT_MS),
      git(['--no-optional-locks', 'log', '-1', '--date=short', '--format=%h%x09%ad%x09%s', '--', '.'], folder, GIT_INFO_TIMEOUT_MS).catch(() => ''),
      git(['--no-optional-locks', 'status', '--porcelain', '--', '.'], folder, GIT_INFO_TIMEOUT_MS)
    ])
    const [hash, day, ...subject] = last.trim().split('\t')
    const name = branch.trim()
    return {
      branch: name === 'HEAD' ? (hash ?? 'detached') : name,
      lastCommit: hash && day ? { subject: subject.join('\t'), day } : null,
      uncommitted: status.split(/\r?\n/).filter((line) => line.trim() !== '').length
    }
  } catch {
    return null
  }
}

/** The git root holding `dir`, or null when it is in no repo, is gone, or git is missing. */
export async function gitRootOf(dir: string): Promise<string | null> {
  try {
    const out = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
    return out ? normPath(out) : null
  } catch {
    return null
  }
}

/** A root holds several projects when two or more of its first-level folders have a manifest. */
export async function isSharedRoot(root: string): Promise<boolean> {
  try {
    let projects = 0
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const names = await readdir(join(root, entry.name)).catch(() => [] as string[])
      if (names.some(isManifest) && ++projects >= 2) return true
    }
    return false
  } catch {
    return false
  }
}

async function markdownFiles(dir: string, out: Array<{ path: string; mtime: number }>): Promise<void> {
  if (out.length >= MAX_MARKDOWN_SEEN) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await markdownFiles(path, out)
    else if (entry.name.toLowerCase().endsWith('.md')) {
      const info = await stat(path).catch(() => null)
      if (info && info.size <= MAX_PLAN_BYTES) out.push({ path, mtime: info.mtimeMs })
    }
    if (out.length >= MAX_MARKDOWN_SEEN) return
  }
}

export interface Evidence {
  commits: Commit[]
  checkboxes: Checkbox[]
  problem: string | null
}

/**
 * Commits on every local branch that touch the folder (the whole repo for a
 * single-project root), and the checkboxes of up to 20 plan files: under the
 * folder, and in a shared root's `docs/` when they name the project.
 */
export async function readEvidence(folder: string, gitRoot: string, shared: boolean, names: string[]): Promise<Evidence> {
  const info = await stat(folder).catch(() => null)
  if (!info?.isDirectory()) return { commits: [], checkboxes: [], problem: 'The folder is gone or can\'t be opened.' }

  let commits: Commit[] = []
  let problem: string | null = null
  try {
    const args = ['log', '--branches', '--date=short', `--format=${GIT_LOG_FORMAT}`, '-n', '200']
    if (shared) args.push('--', relative(gitRoot, folder).replace(/\\/g, '/') || '.')
    commits = parseGitLog(await git(args, gitRoot))
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    problem = missing ? 'Git is not installed, so commits were not read.' : 'The folder is not a git repository, so commits were not read.'
  }

  const files: Array<{ path: string; mtime: number }> = []
  await markdownFiles(folder, files)
  if (shared) {
    const docs: Array<{ path: string; mtime: number }> = []
    await markdownFiles(join(gitRoot, 'docs'), docs)
    files.push(...docs)
  }
  files.sort((a, b) => b.mtime - a.mtime)

  const checkboxes: Checkbox[] = []
  let planFiles = 0
  const inSharedDocs = (path: string): boolean => shared && !normPath(path).toLowerCase().startsWith(normPath(folder).toLowerCase() + '/')
  for (const file of files) {
    if (planFiles >= MAX_PLAN_FILES) break
    const text = await readFile(file.path, 'utf8').catch(() => '')
    if (inSharedDocs(file.path) && !planMentions(text, names, file.path)) continue
    const rel = relative(gitRoot, file.path).replace(/\\/g, '/')
    const boxes = parseCheckboxes(rel, text)
    if (boxes.length === 0) continue
    planFiles++
    checkboxes.push(...boxes)
  }
  return { commits, checkboxes, problem }
}
