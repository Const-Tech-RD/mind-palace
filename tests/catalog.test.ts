import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogError, loadCatalog } from '../src/main/catalog/loader'
import { CATALOG_DIR } from './helpers'
import { formatIssue } from './shared'

/** Paths in messages use the OS separator; the expectations below use `/`. */
const posix = (text: string): string => text.split(sep).join('/')

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A private copy of the real catalog, with one JSON file rewritten. */
function brokenCopy(relativeFile: string, edit: (json: any) => void | string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mind-palace-catalog-'))
  temps.push(dir)
  cpSync(CATALOG_DIR, dir, { recursive: true })
  const file = join(dir, relativeFile)
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const replaced = edit(json)
  writeFileSync(file, typeof replaced === 'string' ? replaced : JSON.stringify(json, null, 2))
  return { dir, file }
}

function issuesOf(dir: string): string[] {
  try {
    loadCatalog(dir)
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogError)
    return (error as CatalogError).issues.map(formatIssue)
  }
  throw new Error('loadCatalog did not throw')
}

describe('the bundled catalog', () => {
  const catalog = loadCatalog(CATALOG_DIR)

  it('loads the four rooms', () => {
    expect(Object.keys(catalog.rooms).sort()).toEqual(['art', 'coding', 'mailroom', 'music'])
    expect(catalog.rules.classification.fallback_room).toBe('mailroom')
    expect(catalog.rules.tracks.streak.milestones).toEqual([2, 3, 5, 8, 13, 21, 34])
    expect(catalog.rules.tracks.goals.milestones).toEqual([2, 3, 5, 8, 13])
  })

  it('defaults weekend grace, which rules.json v0.1 does not spell out', () => {
    const raw = JSON.parse(readFileSync(join(CATALOG_DIR, 'rules.json'), 'utf8'))
    expect(raw.tracks.streak.grace_weekdays).toBeUndefined()
    expect(catalog.rules.tracks.streak.grace_weekdays).toEqual(['saturday', 'sunday'])
  })

  it('normalises "slot" and "slots" to one shape', () => {
    expect(catalog.rooms['music']!.signature.find((s) => s.n === 2)!.slots).toEqual(['desk_left', 'desk_right'])
    expect(catalog.rooms['coding']!.signature.find((s) => s.n === 2)!.slots).toEqual(['desk_center'])
  })

  it('reports the known oddities as warnings, not errors', () => {
    const short = catalog.warnings.map((w) => `${posix(w.file.slice(CATALOG_DIR.length + 1))}: ${w.field}: ${w.message}`)
    expect(short).toEqual([
      'rules.json: base_ladder.goals.0.at: "at": 1 is not one of tracks.goals.milestones [2, 3, 5, 8, 13]; unlocked at that count anyway',
      'rooms/art.json: signature.4.slot: "art_pottery_wheel" has footprint [1, 1] but slot "floor_right" is [2, 1]',
      'rooms/coding.json: signature.4.slot: "coding_arcade" has footprint [1, 1] but slot "floor_right" is [2, 1]',
      'rooms/mailroom.json: signature.1.item: "cardboard_box" is also the reward of signature.0; both copies are placed'
    ])
  })
})

describe('a broken catalog fails loudly with path and field', () => {
  interface Case {
    name: string
    file: string
    edit: (json: any) => void | string
    expected: RegExp
  }

  const cases: Case[] = [
    {
      name: 'wrong type in a room',
      file: 'rooms/music.json',
      edit: (j) => void (j.accent = 'pink'),
      expected: /rooms\/music\.json: accent: must be a #rrggbb colour/
    },
    {
      name: 'missing field in a room',
      file: 'rooms/art.json',
      edit: (j) => void delete j.belongs,
      expected: /rooms\/art\.json: belongs: /
    },
    {
      name: 'nested field in a room',
      file: 'rooms/coding.json',
      edit: (j) => void (j.signature[2].n = 'three'),
      expected: /rooms\/coding\.json: signature\.2\.n: /
    },
    {
      name: 'both slot and slots',
      file: 'rooms/music.json',
      edit: (j) => void (j.signature[1].slot = 'desk_left'),
      expected: /rooms\/music\.json: signature\.1: must have exactly one of "slot" or "slots"/
    },
    {
      name: 'unknown slot in a room',
      file: 'rooms/coding.json',
      edit: (j) => void (j.signature[3].slot = 'ceiling'),
      expected: /rooms\/coding\.json: signature\.3\.slot: unknown slot "ceiling"/
    },
    {
      name: 'item on the wrong layer',
      file: 'rooms/coding.json',
      edit: (j) => void (j.signature[2].slot = 'floor_right'),
      expected: /rooms\/coding\.json: signature\.2\.slot: "coding_whiteboard" is a wall_item but slot "floor_right" holds a floor_item/
    },
    {
      name: 'signature item without an asset entry',
      file: 'rooms/art.json',
      edit: (j) => void delete j.assets.art_easel,
      expected: /rooms\/art\.json: signature\.1\.item: "art_easel" has no entry under "assets"/
    },
    {
      name: 'a room missing a signature the ladder unlocks',
      file: 'rooms/mailroom.json',
      edit: (j) => void j.signature.pop(),
      expected: /rooms\/mailroom\.json: signature: missing signature 5/
    },
    {
      name: 'room id that does not match its file',
      file: 'rooms/art.json',
      edit: (j) => void (j.id = 'atelier'),
      expected: /rooms\/art\.json: id: "atelier" does not match the file name/
    },
    {
      name: 'milestones out of order',
      file: 'rules.json',
      edit: (j) => void (j.tracks.streak.milestones = [2, 5, 3]),
      expected: /rules\.json: tracks\.streak\.milestones: must be strictly increasing/
    },
    {
      name: 'streak ladder step off the milestone list',
      file: 'rules.json',
      edit: (j) => void (j.base_ladder.streak[0].at = 4),
      expected: /rules\.json: base_ladder\.streak\.0\.at: "at": 4 is not one of tracks\.streak\.milestones/
    },
    {
      name: 'ladder step with two rewards',
      file: 'rules.json',
      edit: (j) => void (j.base_ladder.streak[1].shell = 'painted'),
      expected: /rules\.json: base_ladder\.streak\.1: must have exactly one of "item", "signature" or "shell"/
    },
    {
      name: 'ladder step with an unknown slot',
      file: 'rules.json',
      edit: (j) => void (j.base_ladder.goals[2].slot = 'chandelier'),
      expected: /rules\.json: base_ladder\.goals\.2\.slot: unknown slot "chandelier"/
    },
    {
      name: 'unknown fallback room',
      file: 'rules.json',
      edit: (j) => void (j.classification.fallback_room = 'attic'),
      expected: /rules\.json: classification\.fallback_room: no room file has id "attic"/
    },
    {
      name: 'unknown grace weekday',
      file: 'rules.json',
      edit: (j) => void (j.tracks.streak.grace_weekdays = ['caturday']),
      expected: /rules\.json: tracks\.streak\.grace_weekdays\.0: /
    },
    {
      name: 'file that is not JSON',
      file: 'rooms/music.json',
      edit: () => '{ "id": "music", ',
      expected: /rooms\/music\.json: \(file\): is not valid JSON/
    }
  ]

  it.each(cases)('$name', ({ file, edit, expected }) => {
    const { dir, file: path } = brokenCopy(file, edit)
    const issues = issuesOf(dir)
    expect(posix(issues.join('\n'))).toMatch(expected)
    // The absolute path of the broken file is in the message itself.
    expect(issues.some((line) => line.startsWith(`${path}: `))).toBe(true)
  })

  it('lists every problem at once, in one error message', () => {
    const { dir } = brokenCopy('rooms/music.json', (j) => {
      j.accent = 'pink'
      j.examples = []
    })
    writeFileSync(join(dir, 'rooms', 'art.json'), 'nope')
    let message = ''
    try {
      loadCatalog(dir)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/3 problems in the catalog files/)
    expect(message).toContain(`${join(dir, 'rooms', 'music.json')}: accent:`)
    expect(message).toContain(`${join(dir, 'rooms', 'music.json')}: examples:`)
    expect(message).toContain(`${join(dir, 'rooms', 'art.json')}: (file): is not valid JSON`)
  })

  it('reports a missing rules.json and a missing rooms folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mind-palace-catalog-'))
    temps.push(dir)
    const issues = issuesOf(dir)
    expect(issues.some((l) => l.startsWith(`${join(dir, 'rules.json')}: (file): cannot be read`))).toBe(true)
    expect(issues.some((l) => l.startsWith(`${join(dir, 'rooms')}: (directory): cannot be read`))).toBe(true)
  })

  it('accepts weekend grace written into rules.json', () => {
    const { dir } = brokenCopy('rules.json', (j) => void (j.tracks.streak.grace_weekdays = ['sunday']))
    expect(loadCatalog(dir).rules.tracks.streak.grace_weekdays).toEqual(['sunday'])
  })
})
