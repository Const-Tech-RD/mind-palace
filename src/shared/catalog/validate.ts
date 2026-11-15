import type { CatalogIssue, RoomDef, Rules } from './schema'

/**
 * Cross-file checks that a single zod schema cannot express: every slot, room
 * and signature number that one file refers to must exist in another.
 *
 * Errors make the catalog unusable; warnings are oddities the engine can live
 * with (they are logged at start and listed in NOTES.md).
 */
export interface CrossValidation {
  errors: CatalogIssue[]
  warnings: CatalogIssue[]
}

export interface RoomFile {
  file: string
  room: RoomDef
}

export function crossValidateCatalog(rulesFile: string, rules: Rules, roomFiles: RoomFile[]): CrossValidation {
  const errors: CatalogIssue[] = []
  const warnings: CatalogIssue[] = []
  const err = (file: string, field: string, message: string): void => void errors.push({ file, field, message })
  const warn = (file: string, field: string, message: string): void => void warnings.push({ file, field, message })

  const slots = rules.layout.slots
  const hasSlot = (slot: string): boolean => Object.hasOwn(slots, slot)

  // --- rules.json on its own -------------------------------------------------
  for (const [name, slot] of Object.entries(slots)) {
    if (slot.host !== undefined && !hasSlot(slot.host)) {
      err(rulesFile, `layout.slots.${name}.host`, `unknown slot "${slot.host}"`)
    }
  }

  rules.base_ladder.start.forEach((step, i) => {
    if (!hasSlot(step.slot)) err(rulesFile, `base_ladder.start.${i}.slot`, `unknown slot "${step.slot}"`)
  })

  const ladderItems = new Set<string>(rules.base_ladder.start.map((s) => s.item))
  for (const track of ['streak', 'goals'] as const) {
    for (const step of rules.base_ladder[track]) if (step.item !== undefined) ladderItems.add(step.item)
  }

  for (const track of ['streak', 'goals'] as const) {
    const milestones = new Set(rules.tracks[track].milestones)
    rules.base_ladder[track].forEach((step, i) => {
      const field = `base_ladder.${track}.${i}`
      if (!milestones.has(step.at)) {
        const message = `"at": ${step.at} is not one of tracks.${track}.milestones [${[...milestones].join(', ')}]`
        // A streak step off the milestone list could never be announced as a
        // "next unlock". On the goal track the v0.1 file does this on purpose
        // for the trophy shelf (at 1), so there it is only a warning.
        if (track === 'streak') err(rulesFile, `${field}.at`, message)
        else warn(rulesFile, `${field}.at`, `${message}; unlocked at that count anyway`)
      }
      if (step.slot !== undefined && !hasSlot(step.slot)) {
        err(rulesFile, `${field}.slot`, `unknown slot "${step.slot}"`)
      }
      if (step.replaces !== undefined && !ladderItems.has(step.replaces)) {
        err(rulesFile, `${field}.replaces`, `unknown item "${step.replaces}"`)
      }
    })
  }

  const trophy = rules.tracks.goals.every_completion
  if (!hasSlot(trophy.slot)) {
    err(rulesFile, 'tracks.goals.every_completion.slot', `unknown slot "${trophy.slot}"`)
  } else {
    const capacity = slots[trophy.slot]?.capacity ?? 1
    if (capacity < trophy.max) {
      warn(
        rulesFile,
        'tracks.goals.every_completion.max',
        `${trophy.max} is more than the capacity (${capacity}) of slot "${trophy.slot}"; the smaller number wins`
      )
    }
  }

  // --- rooms -----------------------------------------------------------------
  const seenIds = new Map<string, string>()
  for (const { file, room } of roomFiles) {
    const first = seenIds.get(room.id)
    if (first !== undefined) err(file, 'id', `room id "${room.id}" is already used by ${first}`)
    else seenIds.set(room.id, file)
  }

  if (!seenIds.has(rules.classification.fallback_room)) {
    err(
      rulesFile,
      'classification.fallback_room',
      `no room file has id "${rules.classification.fallback_room}"`
    )
  }

  const signatureRefs = new Map<number, string>() // signature number -> field in rules.json
  for (const track of ['streak', 'goals'] as const) {
    rules.base_ladder[track].forEach((step, i) => {
      if (step.signature !== undefined) signatureRefs.set(step.signature, `base_ladder.${track}.${i}.signature`)
    })
  }

  for (const { file, room } of roomFiles) {
    const byNumber = new Map<number, number>()
    const roomItems = new Set(room.signature.map((s) => s.item))
    const itemFirstUse = new Map<string, number>()

    room.signature.forEach((step, i) => {
      const field = `signature.${i}`

      if (byNumber.has(step.n)) err(file, `${field}.n`, `signature number ${step.n} is used twice`)
      else byNumber.set(step.n, i)

      if (step.unlock === 'streak' && !signatureRefs.has(step.n)) {
        err(file, `${field}.n`, `no step in ${rulesFile} base_ladder unlocks signature ${step.n}`)
      }
      if (step.unlock === 'start' && signatureRefs.has(step.n)) {
        err(
          file,
          `${field}.unlock`,
          `signature ${step.n} is a starting item but ${rulesFile} ${signatureRefs.get(step.n)} also unlocks it`
        )
      }

      const asset = room.assets[step.item]
      if (asset === undefined) err(file, `${field}.item`, `"${step.item}" has no entry under "assets"`)

      step.slots.forEach((slotName, j) => {
        const slotField = step.slots.length > 1 ? `${field}.slots.${j}` : `${field}.slot`
        const slot = slots[slotName]
        if (slot === undefined) {
          err(file, slotField, `unknown slot "${slotName}" (not in ${rulesFile} layout.slots)`)
          return
        }
        if (asset === undefined) return
        if (asset.layer !== slot.layer) {
          err(file, slotField, `"${step.item}" is a ${asset.layer} but slot "${slotName}" holds a ${slot.layer}`)
        }
        const a = asset.footprint
        const s = slot.footprint
        if (a !== undefined && s !== undefined && (a[0] !== s[0] || a[1] !== s[1])) {
          warn(
            file,
            slotField,
            `"${step.item}" has footprint [${a.join(', ')}] but slot "${slotName}" is [${s.join(', ')}]`
          )
        }
      })

      if (step.replaces !== undefined && !roomItems.has(step.replaces) && !ladderItems.has(step.replaces)) {
        err(file, `${field}.replaces`, `unknown item "${step.replaces}"`)
      }

      const earlier = itemFirstUse.get(step.item)
      if (earlier !== undefined) {
        warn(file, `${field}.item`, `"${step.item}" is also the reward of signature.${earlier}; both copies are placed`)
      } else {
        itemFirstUse.set(step.item, i)
      }
    })

    for (const [n, ref] of signatureRefs) {
      if (!byNumber.has(n)) err(file, 'signature', `missing signature ${n}, which ${rulesFile} ${ref} unlocks`)
    }
  }

  return { errors, warnings }
}
