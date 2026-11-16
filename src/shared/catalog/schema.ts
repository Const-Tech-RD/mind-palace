import { z } from 'zod'

/**
 * Zod schemas for the bundled catalog: `catalog/rules.json` and
 * `catalog/rooms/*.json`. Pure (no fs); the loader in src/main/catalog reads
 * the files and reports errors with their path.
 */

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const SHELL_TIERS = ['bare', 'painted', 'finished'] as const
export type ShellTier = (typeof SHELL_TIERS)[number]

export const LAYERS = ['wall_item', 'rug', 'floor_item', 'surface_item'] as const
export type Layer = (typeof LAYERS)[number]

/** What a slot accepts. An item lists the kinds it may stand in; the room editor only offers those slots. */
export const SLOT_KINDS = ['desk', 'desk_surface', 'floor', 'rug', 'wall', 'trophy_shelf'] as const
export type SlotKind = (typeof SLOT_KINDS)[number]

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a lower-case id (letters, digits, underscores)')
const positiveInt = z.number().int().positive()
const pair = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
const milestones = z
  .array(positiveInt)
  .min(1)
  .refine((m) => m.every((v, i) => i === 0 || v > m[i - 1]!), 'must be strictly increasing')

const placedItemSchema = z.object({
  item: id,
  slot: id
})

/**
 * One step of a ladder. Exactly one reward per step: an item (with its slot),
 * a signature number (resolved against each room's `signature` list), or a
 * shell tier.
 */
const ladderStepSchema = z
  .object({
    at: positiveInt,
    item: id.optional(),
    slot: id.optional(),
    replaces: id.optional(),
    signature: positiveInt.optional(),
    shell: z.enum(SHELL_TIERS).optional()
  })
  .superRefine((step, ctx) => {
    const rewards = [step.item, step.signature, step.shell].filter((v) => v !== undefined).length
    if (rewards !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'must have exactly one of "item", "signature" or "shell"'
      })
    }
    if (step.item !== undefined && step.slot === undefined) {
      ctx.addIssue({ code: 'custom', path: ['slot'], message: 'is required when "item" is set' })
    }
    if (step.item === undefined && (step.slot !== undefined || step.replaces !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: '"slot" and "replaces" are only allowed together with "item"'
      })
    }
  })

const slotSchema = z.object({
  kind: z.enum(SLOT_KINDS),
  layer: z.enum(LAYERS),
  tile: pair.optional(),
  footprint: pair.optional(),
  host: id.optional(),
  wall: z.enum(['left', 'right']).optional(),
  from_tile: z.number().int().nonnegative().optional(),
  width: positiveInt.optional(),
  bottom_z: z.number().nonnegative().optional(),
  /** How many items the slot holds. Absent means 1. */
  capacity: positiveInt.optional()
})

export const rulesSchema = z.object({
  version: z.string(),
  classification: z.object({
    rooms_per_chat: z.literal(1),
    fallback_room: id
  }),
  day_boundary: z.literal('local_midnight'),
  tracks: z.object({
    streak: z.object({
      description: z.string().optional(),
      scope: z.literal('per_room'),
      milestones,
      on_break: z.literal('reset_counter_keep_items'),
      next_unlock: z.string().optional(),
      /**
       * Weekdays that never end a streak and only add to it when there was a
       * chat. Not present in rules.json v0.1 (see NOTES.md); the default is the
       * plan's behaviour.
       */
      grace_weekdays: z.array(z.enum(WEEKDAYS)).default(['saturday', 'sunday'])
    }),
    goals: z.object({
      description: z.string().optional(),
      scope: z.literal('per_room'),
      milestones,
      max_counted_per_day: z.literal(1),
      every_completion: z.object({
        item: id,
        slot: id,
        max: positiveInt
      })
    })
  }),
  base_ladder: z.object({
    start: z.array(placedItemSchema),
    streak: z.array(ladderStepSchema),
    goals: z.array(ladderStepSchema)
  }),
  layout: z.object({
    floor: pair,
    note: z.string().optional(),
    slots: z.record(id, slotSchema)
  })
})

const signatureStepSchema = z
  .object({
    n: positiveInt,
    unlock: z.enum(['start', 'streak']),
    item: id,
    slot: id.optional(),
    /** music.json uses the plural form for an item placed twice. */
    slots: z.array(id).min(1).optional(),
    replaces: id.optional()
  })
  .superRefine((step, ctx) => {
    if ((step.slot === undefined) === (step.slots === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'must have exactly one of "slot" or "slots"' })
    }
  })
  .transform(({ slot, slots, ...rest }) => ({
    ...rest,
    /** Normalised: always an array, whichever spelling the file used. */
    slots: slots ?? (slot !== undefined ? [slot] : [])
  }))

const assetSchema = z.object({
  layer: z.enum(LAYERS),
  footprint: pair.optional(),
  width: positiveInt.optional(),
  height: z.number().nonnegative(),
  /** Slot kinds it may stand in. Room assets may leave it out: they then take their slots' kinds. */
  slots: z.array(z.enum(SLOT_KINDS)).min(1).optional(),
  /** Art variants (asset spec 7), same canvas and anchor; the user picks one. */
  variants: z.array(id).default([]),
  mirrorable: z.boolean().default(true),
  note: z.string().optional()
})

/** catalog/items.json: base and shared items, which no room file describes. */
export const itemsFileSchema = z.object({
  note: z.string().optional(),
  items: z.record(id, assetSchema.extend({ slots: z.array(z.enum(SLOT_KINDS)).min(1) }))
})

export const roomSchema = z.object({
  id,
  name: z.string().min(1),
  belongs: z.string().min(1),
  not_here: z.string(),
  examples: z.array(z.string().min(1)).min(1),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour'),
  signature: z.array(signatureStepSchema).min(1),
  assets: z.record(id, assetSchema)
})

export type Rules = z.infer<typeof rulesSchema>
export type LadderStep = Rules['base_ladder']['streak'][number]
export type SlotDef = Rules['layout']['slots'][string]
export type RoomDef = z.infer<typeof roomSchema>
export type SignatureStep = RoomDef['signature'][number]

export type ItemsFile = z.infer<typeof itemsFileSchema>

/** One placeable item, from items.json or a room's assets. */
export interface ItemDef {
  id: string
  layer: Layer
  footprint?: [number, number]
  width?: number
  height: number
  slots: SlotKind[]
  variants: string[]
  mirrorable: boolean
}

/** Everything the engine and the UI need from the catalog files. */
export interface Catalog {
  rules: Rules
  /** Keyed by room id. */
  rooms: Record<string, RoomDef>
  /** Every placeable item: items.json merged with each room's assets. */
  items: Record<string, ItemDef>
}

/** One problem in one catalog file, addressed by file path and field. */
export interface CatalogIssue {
  file: string
  /** Dotted path of the offending field, e.g. `signature.1.slot`; `(root)` for the whole file. */
  field: string
  message: string
}

export function formatIssue(issue: CatalogIssue): string {
  return `${issue.file}: ${issue.field}: ${issue.message}`
}

export function zodIssuesToCatalogIssues(file: string, error: z.ZodError): CatalogIssue[] {
  return error.issues.map((issue) => ({
    file,
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message
  }))
}
