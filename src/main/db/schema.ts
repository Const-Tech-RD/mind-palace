import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The seven tables from the plan's "Data model".
 *
 * - Timestamps are UTC ISO-8601 strings (`2026-11-15T14:03:00.000Z`).
 * - `local_day` is a `YYYY-MM-DD` calendar day in the settings timezone.
 * - `room_id` refers to the Mail room (catalog/rooms/mailroom.json) or a row of
 *   `rooms`, the rooms the person materialised.
 * - Unlocks are derived by src/shared/engine; `room_progress` only keeps each
 *   room's high-water marks so an unlock is never lost when chats move.
 */

export const ROOM_SOURCES = ['model', 'user'] as const
export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const
export const PROJECT_STATES = ['suggested', 'active', 'paused', 'done', 'dropped'] as const
export const REMINDER_ACTIONS = ['opened', 'done', 'snoozed', 'paused', 'dropped', 'ignored'] as const
export const FOLDER_SOURCES = ['detected', 'user'] as const
export const MILESTONE_STATUSES = ['done', 'planned'] as const
export const EVIDENCE_KINDS = ['commit', 'plan', 'chat', 'user'] as const
export const PROPOSAL_KINDS = ['add', 'tick'] as const
export const PROPOSAL_ANSWERS = ['accepted', 'dismissed'] as const

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    /** Null until the chat has been classified. */
    roomId: text('room_id'),
    /** `user` means the chat was moved by hand; the classifier never overrides it. */
    roomSource: text('room_source', { enum: ROOM_SOURCES }),
    classifiedAt: text('classified_at'),
    sdkSessionId: text('sdk_session_id'),
    createdAt: text('created_at').notNull().default(utcNow),
    lastMessageAt: text('last_message_at'),
    /**
     * The project the "Track it?" card is offering for this chat: a new
     * `suggested` project, or an open one the classifier recognised. Plain id,
     * no foreign key (projects references chats); cleared when answered.
     */
    suggestedProjectId: text('suggested_project_id'),
    /** Set when the user answered "Just a question": the chat is never offered again. */
    projectDismissedAt: text('project_dismissed_at'),
    /** The area of life the chat is about, as a key (`3d_printing`); set once, then kept. */
    area: text('area'),
    /** The area as the model first named it ("3D printing"). */
    areaName: text('area_name'),
    /** Where an imported Claude Code session ran; null for every other chat. */
    cwd: text('cwd')
  },
  (t) => [index('chats_room_idx').on(t.roomId), index('chats_last_message_idx').on(t.lastMessageAt)]
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MESSAGE_ROLES }).notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull().default(utcNow),
    /**
     * `YYYY-MM-DD` in the settings timezone when the message was written; feeds
     * the streak. Stored so a later timezone change never rewrites past days.
     * Null only on rows older than the column, until the launch backfill.
     */
    localDay: text('local_day'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out')
  },
  (t) => [index('messages_chat_idx').on(t.chatId, t.createdAt)]
)

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    roomId: text('room_id').notNull(),
    originChatId: text('origin_chat_id').references(() => chats.id, { onDelete: 'set null' }),
    /** `suggested` = flagged by the model, waiting for "Track it". */
    state: text('state', { enum: PROJECT_STATES }).notNull().default('suggested'),
    nextStep: text('next_step'),
    lastActivityAt: text('last_activity_at'),
    snoozedUntil: text('snoozed_until'),
    remindersSent: integer('reminders_sent').notNull().default(0),
    createdAt: text('created_at').notNull().default(utcNow),
    closedAt: text('closed_at'),
    /** The project's folder on disk, where its plans and git history are read; null when none is known. */
    folder: text('folder'),
    /** The git root that holds `folder` (the same path for a repo with one project). */
    gitRoot: text('git_root'),
    /** `user` once the person set or cleared the folder: detection never replaces it. */
    folderSource: text('folder_source', { enum: FOLDER_SOURCES }),
    /** When the sweep last looked for this project's chats; later sweeps only read newer chats. */
    sweptAt: text('swept_at')
  },
  (t) => [index('projects_room_state_idx').on(t.roomId, t.state)]
)

export const projectChats = sqliteTable(
  'project_chats',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.projectId, t.chatId] }), index('project_chats_chat_idx').on(t.chatId)]
)

export const goalCompletions = sqliteTable(
  'goal_completions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    /** `YYYY-MM-DD` in the settings timezone at the moment of completion. */
    localDay: text('local_day').notNull()
    // No "counted" flag: at most one completion per room counts each local day,
    // and the engine derives that from the rows (a stored flag went stale on reopen).
  },
  (t) => [
    index('goal_completions_room_day_idx').on(t.roomId, t.localDay),
    index('goal_completions_project_idx').on(t.projectId)
  ]
)

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    dueAt: text('due_at').notNull(),
    sentAt: text('sent_at'),
    message: text('message'),
    /** The success measure for the first week; null until the reminder is resolved. */
    action: text('action', { enum: REMINDER_ACTIONS })
  },
  (t) => [index('reminders_project_idx').on(t.projectId), index('reminders_due_idx').on(t.dueAt)]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

/**
 * Where the user put an earned item (plan v2, Placement). No row means the
 * catalog's default slot. The engine never moves, hides or removes an item
 * that has a row here.
 */
export const placements = sqliteTable(
  'placements',
  {
    roomId: text('room_id').notNull(),
    /** The engine's key for the item: `item@defaultSlot#index`. */
    instance: text('instance').notNull(),
    /** Null means the default slot. */
    slot: text('slot'),
    variant: text('variant'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull().default(utcNow)
  },
  (t) => [primaryKey({ columns: [t.roomId, t.instance] })]
)


/**
 * Earned stays earned: the most a room ever reached on each track. The engine
 * judges unlocks against the higher of these and what the room's chats give now.
 */
export const roomProgress = sqliteTable('room_progress', {
  roomId: text('room_id').primaryKey(),
  bestStreak: integer('best_streak').notNull().default(0),
  goalCount: integer('goal_count').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(utcNow)
})

/**
 * The rooms the person materialised (the Mail room is the catalog's file).
 * A room never changes cell once made; JSON columns hold its signature picks
 * (`[{item, slots}]`, in order) and its classifier text.
 */
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  area: text('area').notNull().unique(),
  accent: integer('accent').notNull(),
  cellX: integer('cell_x').notNull(),
  cellY: integer('cell_y').notNull(),
  signature: text('signature').notNull(),
  classifier: text('classifier').notNull(),
  createdAt: text('created_at').notNull().default(utcNow)
})

/** Areas the person dismissed as a room; counts are always derived from `chats`. */
export const areaSuggestions = sqliteTable('area_suggestions', {
  area: text('area').primaryKey(),
  displayName: text('display_name').notNull(),
  dismissedAt: text('dismissed_at').notNull(),
  /** Chats in the area when it was dismissed; it comes back after 5 more. */
  dismissedCount: integer('dismissed_count').notNull()
})

/** Files an imported Claude Code session edited, with how often: how a project's folder is found. */
export const chatFiles = sqliteTable(
  'chat_files',
  {
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    edits: integer('edits').notNull()
  },
  (t) => [primaryKey({ columns: [t.chatId, t.path] })]
)

/**
 * A project's milestones, in order. The first draft writes them; after that the
 * model only proposes (`milestone_proposals`) and the person's edits always win.
 * A deleted milestone stays as a tombstone so a refresh never brings it back.
 */
export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** The title it was drafted or added with; a renamed milestone is still recognised by it. */
    originalTitle: text('original_title').notNull(),
    position: integer('position').notNull(),
    status: text('status', { enum: MILESTONE_STATUSES }).notNull(),
    /** `YYYY-MM-DD` it happened, for done ones. */
    doneOn: text('done_on'),
    /** What backs the status: a commit, a plan checkbox, the chats, or the person. */
    evidence: text('evidence', { enum: EVIDENCE_KINDS }).notNull(),
    /** Commit short hash, `file:line` of a plan checkbox, or a chat id. */
    evidenceRef: text('evidence_ref'),
    /** True once the person changed anything about it. */
    edited: integer('edited', { mode: 'boolean' }).notNull().default(false),
    /** True once the person ticked or unticked it: it gets no tick proposals. */
    statusByUser: integer('status_by_user', { mode: 'boolean' }).notNull().default(false),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull().default(utcNow)
  },
  (t) => [index('milestones_project_idx').on(t.projectId, t.position)]
)

/** What a refresh suggests: a new milestone or a tick, waiting for Accept or Dismiss. Kept after the answer. */
export const milestoneProposals = sqliteTable(
  'milestone_proposals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
    /** The milestone a `tick` is for. */
    milestoneId: text('milestone_id').references(() => milestones.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Where an `add` goes: after this milestone, or at the end when null. */
    afterId: text('after_id'),
    evidence: text('evidence', { enum: EVIDENCE_KINDS }).notNull(),
    evidenceRef: text('evidence_ref'),
    doneOn: text('done_on'),
    answered: text('answered', { enum: PROPOSAL_ANSWERS }),
    createdAt: text('created_at').notNull().default(utcNow)
  },
  (t) => [index('milestone_proposals_project_idx').on(t.projectId)]
)

/** Chats the person unticked in a project's sweep: never offered to that project again. */
export const sweepDismissals = sqliteTable(
  'sweep_dismissals',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.projectId, t.chatId] })]
)

/** A short model summary of one chat (JSON: what was done and planned, by day); rebuilt when the chat has newer messages. */
export const chatDigests = sqliteTable('chat_digests', {
  chatId: text('chat_id')
    .primaryKey()
    .references(() => chats.id, { onDelete: 'cascade' }),
  digest: text('digest').notNull(),
  throughMessageAt: text('through_message_at').notNull()
})
