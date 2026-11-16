import { describe, expect, it } from 'vitest'
import { detectFolder, isManifest, normPath, type EditFact } from '../src/shared/folders'

/** A Windows path, as the transcripts hold them. */
const win = (p: string): string => p.split('/').join(String.fromCharCode(92))
const shared = (root: string): boolean => root.toLowerCase() === 'c:/users/projects'

describe('normPath', () => {
  it('uses / separators, a lower-case drive and no trailing slash', () => {
    expect(normPath(win('C:/Users/projects/tuautord/'))).toBe('c:/Users/projects/tuautord')
  })
})

describe('isManifest', () => {
  it('knows project manifests by name and by suffix', () => {
    expect(isManifest('package.json')).toBe(true)
    expect(isManifest('Api.csproj')).toBe(true)
    expect(isManifest('sketch.ino')).toBe(true)
    expect(isManifest('README.md')).toBe(false)
  })
})

describe('detectFolder', () => {
  it('uses the root of a repo that holds one project', () => {
    const facts: EditFact[] = [{ path: win('C:/Users/projects/oni-thing/web/src/a.tsx'), edits: 9, gitRoot: 'C:/Users/projects/oni-thing' }]
    expect(detectFolder(facts, shared)).toEqual({ folder: 'c:/Users/projects/oni-thing', gitRoot: 'c:/Users/projects/oni-thing' })
  })

  it('in a shared root, picks the first-level folder with the most edits, not docs/', () => {
    const facts: EditFact[] = [
      { path: win('C:/Users/projects/tuautord/src/a.ts'), edits: 5, gitRoot: 'C:/Users/projects' },
      { path: win('C:/Users/projects/docs/superpowers/plans/p.md'), edits: 8, gitRoot: 'C:/Users/projects' },
      { path: win('C:/Users/projects/manda/x.ts'), edits: 2, gitRoot: 'C:/Users/projects' }
    ]
    expect(detectFolder(facts, (r) => r.toLowerCase() === 'c:/users/projects')).toEqual({
      folder: 'c:/Users/projects/tuautord',
      gitRoot: 'c:/Users/projects'
    })
  })

  it('gives no folder when a shared root only saw docs/ or dot-folder edits', () => {
    const facts: EditFact[] = [
      { path: 'C:/Users/projects/docs/plans/p.md', edits: 3, gitRoot: 'C:/Users/projects' },
      { path: 'C:/Users/projects/.github/workflows/ci.yml', edits: 1, gitRoot: 'C:/Users/projects' },
      { path: 'C:/Users/projects/README.md', edits: 1, gitRoot: 'C:/Users/projects' }
    ]
    expect(detectFolder(facts, () => true)).toBeNull()
  })

  it('picks the git root most edits fall under', () => {
    const facts: EditFact[] = [
      { path: 'C:/a/x.ts', edits: 2, gitRoot: 'C:/a' },
      { path: 'C:/b/y.ts', edits: 7, gitRoot: 'C:/b' }
    ]
    expect(detectFolder(facts, () => false)?.gitRoot).toBe('c:/b')
  })

  it('ignores files outside any repo, and gives null with none in a repo', () => {
    expect(detectFolder([{ path: 'C:/tmp/x.md', edits: 4, gitRoot: null }], () => false)).toBeNull()
    expect(detectFolder([], () => false)).toBeNull()
  })

  it('breaks a tie between first-level folders alphabetically', () => {
    const facts: EditFact[] = [
      { path: 'C:/p/zeta/a.ts', edits: 3, gitRoot: 'C:/p' },
      { path: 'C:/p/alpha/b.ts', edits: 3, gitRoot: 'C:/p' }
    ]
    expect(detectFolder(facts, () => true)?.folder).toBe('c:/p/alpha')
  })
})
