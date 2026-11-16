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

  it('loads only the Mail room; every other room is made by the person', () => {
    expect(Object.keys(catalog.rooms)).toEqual(['mailroom'])
    expect(catalog.rooms['mailroom']).toMatchObject({ cell: [0, 0], area: null, accent: 'mp-room-mailroom' })
    expect(catalog.rules.classification.fallback_room).toBe('mailroom')
    expect(catalog.rules.tracks.streak.milestones).toEqual([2, 3, 5, 8, 13, 21, 34])
    expect(catalog.rules.tracks.goals.milestones).toEqual([2, 3, 5, 8, 13])
  })

  it('has a library of items tagged by area, merged into the item registry', () => {
    const tagged = (area: string) => Object.values(catalog.library).filter((i) => i.areas.includes(area)).map((i) => i.id)
    expect(tagged('software')).toEqual(expect.arrayContaining(['coding_laptop', 'coding_monitor', 'coding_whiteboard', 'coding_rack', 'coding_arcade']))
    expect(tagged('music')).toEqual(expect.arrayContaining(['music_mic', 'music_speakers', 'music_keyboard', 'music_guitar', 'music_mixer']))
    expect(tagged('art')).toEqual(expect.arrayContaining(['art_sketchbook', 'art_easel', 'art_paint_cart', 'art_pegboard', 'art_pottery_wheel']))
    expect(tagged('finance').length).toBeGreaterThanOrEqual(4)
    expect(tagged('3d_printing').length).toBeGreaterThanOrEqual(4)
    for (const id of Object.keys(catalog.library)) expect(catalog.items[id], id).toBeDefined()
    expect(catalog.items['coding_monitor']).toMatchObject({ layer: 'surface_item', slots: ['desk_surface'] })
    expect(catalog.library['music_speakers']).toMatchObject({ slots: ['desk_surface'], slot: 'desk_left' })
  })

  it('defines every item a ladder or a signature can place, with its size and slot kinds', () => {
    const named = new Set<string>([
      ...catalog.rules.base_ladder.start.map((s) => s.item),
      ...catalog.rules.base_ladder.streak.flatMap((s) => (s.item ? [s.item] : [])),
      ...catalog.rules.base_ladder.goals.flatMap((s) => (s.item ? [s.item] : [])),
      catalog.rules.tracks.goals.every_completion.item,
      ...Object.values(catalog.rooms).flatMap((r) => r.signature.map((s) => s.item))
    ])
    for (const item of named) expect(catalog.items[item], item).toBeDefined()
    expect(catalog.items['base_desk']).toMatchObject({ layer: 'floor_item', footprint: [3, 1], height: 1, slots: ['desk'], variants: [] })
    expect(catalog.items['trophy']).toMatchObject({ slots: ['trophy_shelf'] })
    // A room asset without "slots" takes the kinds of the slots it is placed in.
    expect(catalog.items['mail_letter_tray']).toMatchObject({ layer: 'surface_item', slots: ['desk_surface'], mirrorable: true })
  })

  it('gives every slot a kind', () => {
    const kinds = Object.fromEntries(Object.entries(catalog.rules.layout.slots).map(([id, slot]) => [id, slot.kind]))
    expect(kinds).toMatchObject({ desk: 'desk', desk_center: 'desk_surface', seat: 'floor', rug: 'rug', wall_left_b: 'wall', trophy_shelf: 'trophy_shelf' })
  })

  it('defaults weekend grace, which rules.json v0.1 does not spell out', () => {
    const raw = JSON.parse(readFileSync(join(CATALOG_DIR, 'rules.json'), 'utf8'))
    expect(raw.tracks.streak.grace_weekdays).toBeUndefined()
    expect(catalog.rules.tracks.streak.grace_weekdays).toEqual(['saturday', 'sunday'])
  })

  it('normalises "slot" and "slots" to one shape', () => {
    expect(catalog.rooms['mailroom']!.signature.find((s) => s.n === 2)!.slots).toEqual(['beside_seat'])
  })

  it('reports the known oddities as warnings, not errors', () => {
    const short = catalog.warnings.map((w) => `${posix(w.file.slice(CATALOG_DIR.length + 1))}: ${w.field}: ${w.message}`)
    expect(short).toEqual([
      'rules.json: base_ladder.goals.0.at: "at": 1 is not one of tracks.goals.milestones [2, 3, 5, 8, 13]; unlocked at that count anyway',
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
      name: 'ladder item with no definition',
      file: 'rules.json',
      edit: (j) => void (j.base_ladder.streak[0].item = 'base_stool'),
      expected: /rules\.json: base_ladder\.streak\.0\.item: "base_stool" has no item definition/
    },
    {
      name: 'item that cannot go in its own default slot',
      file: 'items.json',
      edit: (j) => void (j.items.base_couch.slots = ['wall']),
      expected: /items\.json: items\.base_couch\.slots: does not include "floor", the kind of slot "couch"/
    },
    {
      name: 'item defined twice',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.assets.base_desk = { layer: 'floor_item', footprint: [3, 1], height: 1 }),
      expected: /mailroom\.json: assets\.base_desk: is already defined in items\.json/
    },
    {
      name: 'slot without a kind',
      file: 'rules.json',
      edit: (j) => void delete j.layout.slots.seat.kind,
      expected: /rules\.json: layout\.slots\.seat\.kind: /
    },
    {
      name: 'wrong type in a room',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.accent = 'pink'),
      expected: /rooms\/mailroom\.json: accent: must be a room accent token/
    },
    {
      name: 'missing field in a room',
      file: 'rooms/mailroom.json',
      edit: (j) => void delete j.belongs,
      expected: /rooms\/mailroom\.json: belongs: /
    },
    {
      name: 'nested field in a room',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.signature[2].n = 'three'),
      expected: /rooms\/mailroom\.json: signature\.2\.n: /
    },
    {
      name: 'both slot and slots',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.signature[1].slots = ['seat']),
      expected: /rooms\/mailroom\.json: signature\.1: must have exactly one of "slot" or "slots"/
    },
    {
      name: 'unknown slot in a room',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.signature[3].slot = 'ceiling'),
      expected: /rooms\/mailroom\.json: signature\.3\.slot: unknown slot "ceiling"/
    },
    {
      name: 'item on the wrong layer',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.signature[2].slot = 'floor_right'),
      expected: /rooms\/mailroom\.json: signature\.2\.slot: "mail_sorting_shelf" is a wall_item but slot "floor_right" holds a floor_item/
    },
    {
      name: 'signature item without an asset entry',
      file: 'rooms/mailroom.json',
      edit: (j) => void delete j.assets.mail_parcel_stack,
      expected: /rooms\/mailroom\.json: signature\.3\.item: "mail_parcel_stack" has no entry under "assets"/
    },
    {
      name: 'a room missing a signature the ladder unlocks',
      file: 'rooms/mailroom.json',
      edit: (j) => void j.signature.pop(),
      expected: /rooms\/mailroom\.json: signature: missing signature 5/
    },
    {
      name: 'room id that does not match its file',
      file: 'rooms/mailroom.json',
      edit: (j) => void (j.id = 'atelier'),
      expected: /rooms\/mailroom\.json: id: "atelier" does not match the file name/
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
      file: 'rooms/mailroom.json',
      edit: () => '{ "id": "mailroom", ',
      expected: /rooms\/mailroom\.json: \(file\): is not valid JSON/
    },
    {
      name: 'library item with an unknown slot kind',
      file: 'library.json',
      edit: (j) => void (j.items.coding_rack.slots = ['ceiling']),
      expected: /library\.json: items\.coding_rack\.slots\.0: /
    },
    {
      name: 'library item with no area',
      file: 'library.json',
      edit: (j) => void (j.items.coding_rack.areas = []),
      expected: /library\.json: items\.coding_rack\.areas: /
    },
    {
      name: 'library item that items.json already defines',
      file: 'library.json',
      edit: (j) => void (j.items.base_desk = { layer: 'floor_item', footprint: [3, 1], height: 1, slots: ['desk'], areas: ['software'] }),
      expected: /library\.json: items\.base_desk: is already defined in items\.json/
    },
    {
      name: 'library slot hint that the layout does not have',
      file: 'library.json',
      edit: (j) => void (j.items.coding_rack.slot = 'ceiling'),
      expected: /library\.json: items\.coding_rack\.slot: unknown slot "ceiling"/
    },
    {
      name: 'library slot hint of the wrong kind',
      file: 'library.json',
      edit: (j) => void (j.items.coding_rack.slot = 'wall_right_b'),
      expected: /library\.json: items\.coding_rack\.slot: "coding_rack" may not stand in a "wall" slot/
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
    const { dir } = brokenCopy('rooms/mailroom.json', (j) => {
      j.accent = 'pink'
      j.examples = []
    })
    writeFileSync(join(dir, 'library.json'), 'nope')
    let message = ''
    try {
      loadCatalog(dir)
    } catch (error) {
      message = (error as Error).message
    }
    // The broken Mail room file also leaves the fallback room without a file.
    expect(message).toMatch(/4 problems in the catalog files/)
    expect(message).toContain('classification.fallback_room: no room file has id "mailroom"')
    expect(message).toContain(`${join(dir, 'rooms', 'mailroom.json')}: accent:`)
    expect(message).toContain(`${join(dir, 'rooms', 'mailroom.json')}: examples:`)
    expect(message).toContain(`${join(dir, 'library.json')}: (file): is not valid JSON`)
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
