/**
 * Where a project lives on disk, found from the files its Claude Code sessions
 * edited. Pure: the git roots and which roots are shared come in as facts.
 */

/** Files that mark a folder as a project of its own. */
export const MANIFESTS: readonly string[] = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'platformio.ini',
  '*.csproj',
  '*.ino'
]

export function isManifest(fileName: string): boolean {
  const name = fileName.toLowerCase()
  return MANIFESTS.some((m) => (m.startsWith('*') ? name.endsWith(m.slice(1).toLowerCase()) : name === m.toLowerCase()))
}

/** `/` separators, a lower-case drive letter, no trailing slash. Case is otherwise kept; compare with `pathKey`. */
export function normPath(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(slashed) ? slashed[0]!.toLowerCase() + slashed.slice(1) : slashed
}

/** Windows paths are case-insensitive: the key two paths are compared by. */
export const pathKey = (p: string): string => normPath(p).toLowerCase()

export interface EditFact {
  /** A file a session edited, as the transcript holds it. */
  path: string
  edits: number
  /** The git root holding the file, or null when it is in no repo (or gone). */
  gitRoot: string | null
}

/** The most-counted key; a tie goes to the alphabetically first. */
function top(counts: Map<string, number>): string | null {
  let best: string | null = null
  for (const [key, n] of counts) {
    const bestN = best === null ? -1 : counts.get(best)!
    if (n > bestN || (n === bestN && best !== null && key < best)) best = key
  }
  return best
}

/**
 * The project's folder: the git root most edits fall under, or, when that root
 * is shared by several projects, its first-level folder with the most edits
 * (not `docs/` or dot-folders). Null when no edited file is in a repo, or a
 * shared root only saw edits outside any project folder.
 */
export function detectFolder(facts: EditFact[], isShared: (gitRoot: string) => boolean): { folder: string; gitRoot: string } | null {
  const inRepo = facts.filter((f): f is EditFact & { gitRoot: string } => f.gitRoot !== null && f.edits > 0)
  const byRoot = new Map<string, number>()
  const rootName = new Map<string, string>()
  for (const f of inRepo) {
    const key = pathKey(f.gitRoot)
    byRoot.set(key, (byRoot.get(key) ?? 0) + f.edits)
    if (!rootName.has(key)) rootName.set(key, normPath(f.gitRoot))
  }
  const rootKey = top(byRoot)
  if (rootKey === null) return null
  const gitRoot = rootName.get(rootKey)!
  if (!isShared(gitRoot)) return { folder: gitRoot, gitRoot }

  const byFolder = new Map<string, number>()
  const folderName = new Map<string, string>()
  for (const f of inRepo) {
    if (pathKey(f.gitRoot) !== rootKey) continue
    const path = normPath(f.path)
    if (!path.toLowerCase().startsWith(rootKey + '/')) continue
    const parts = path.slice(rootKey.length + 1).split('/')
    // A file right under the root belongs to no project folder.
    if (parts.length < 2) continue
    const first = parts[0]!
    if (first.toLowerCase() === 'docs' || first.startsWith('.')) continue
    const key = first.toLowerCase()
    byFolder.set(key, (byFolder.get(key) ?? 0) + f.edits)
    if (!folderName.has(key)) folderName.set(key, first)
  }
  const folderKey = top(byFolder)
  return folderKey === null ? null : { folder: `${gitRoot}/${folderName.get(folderKey)}`, gitRoot }
}
