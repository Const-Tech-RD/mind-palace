import type { ShellTier } from '../catalog/schema'
import type { LocalDay } from './days'

/**
 * The event history the engine works on. It is a snapshot of what the database
 * holds *now*, already attributed to the room each chat currently lives in:
 * moving a chat re-attributes all of its messages, and reopening a goal removes
 * its completion (see `buildRoomEvents` and `reopenGoal` in ./events).
 */
export type RoomEvent =
  | {
      kind: 'user_message'
      roomId: string
      /** Local calendar day of the message. */
      localDay: LocalDay
      chatId?: string
    }
  | {
      kind: 'goal_completed'
      roomId: string
      /** Local calendar day the project was marked done. */
      localDay: LocalDay
      projectId: string
    }
  | {
      /** A project as it stands now; drives the room's decay. */
      kind: 'project'
      roomId: string
      projectId: string
      state: string
      /** Local day of the project's last activity, or null if there was none yet. */
      lastActivityDay: LocalDay | null
    }

export type Track = 'streak' | 'goals'

/** Where a placed item came from. */
export type ItemSource = 'start' | 'streak' | 'goals' | 'trophy'

export interface PlacedItem {
  item: string
  slot: string
  /** Position inside the slot; always 0 except in multi-capacity slots (trophies). */
  index: number
  source: ItemSource
  /** The streak length or goal count that unlocked it; null for starting items. */
  at: number | null
  /** The room's signature number (1-5) when this is a signature item, else null. */
  signature: number | null
  /** The item it took the place of in the same slot, if any. */
  replaces: string | null
}

export type Reward =
  | { type: 'item'; item: string; slots: string[]; signature: number | null; replaces: string | null }
  | { type: 'shell'; shell: ShellTier }

export interface NextUnlock {
  track: Track
  /** The streak length or goal count to reach. */
  at: number
  /** How far away it is: `at` minus the current streak, or minus the goal count. */
  remaining: number
  /** False for a ladder step that is not on the track's milestone list (the trophy shelf at 1 goal). */
  milestone: boolean
  rewards: Reward[]
}

export type DecayLevel = 0 | 1 | 2 | 3 | 4

export interface RoomState {
  roomId: string
  today: LocalDay
  streak: {
    /** Room days in the current run (yesterday's value until there is a chat today). */
    current: number
    /** Longest run ever. Milestones are judged against this, so they never un-unlock on a break. */
    best: number
    lastRoomDay: LocalDay | null
    milestonesReached: number[]
  }
  goals: {
    /** Counted completions: at most one per local day. */
    count: number
    /** All completions, including same-day ones that were not counted. */
    completions: number
    milestonesReached: number[]
    trophies: number
  }
  shell: ShellTier
  /** What stands in the room now, after replacements, in unlock order. */
  items: PlacedItem[]
  /** Earned but not shown, because a later item took their slot (the crate once the chair is there). */
  replaced: PlacedItem[]
  /** From the quietest active project's weekdays without activity (plan v2, Decay). */
  decay: { level: DecayLevel; weekdaysQuiet: number; projectId: string | null }
  nextUnlock: {
    streak: NextUnlock | null
    goals: NextUnlock | null
  }
}

export type UnlockEvent =
  | ({ kind: 'item'; roomId: string } & PlacedItem)
  | { kind: 'shell'; roomId: string; shell: ShellTier; previous: ShellTier }
