/**
 * The palace view's model: each room's state from the progression engine,
 * what is new since the room was last looked at, and the words to show for it.
 * Pure: rows in, view model out.
 */
import type { Catalog, ShellTier } from './catalog'
import { buildFloor, type FloorView } from './floor'
import { dropTargets } from './editMode'
import { resolvePlacements, type InventoryItem, type Placement, type ResolvedItem } from './placements'
import {
  buildRoomEvents,
  computeRoomState,
  type HistoryRows,
  type KeptProgress,
  type LocalDay,
  type NextUnlock,
  type PlacedItem,
  type RoomState,
  type Track
} from './engine'

export interface PalaceRoom {
  id: string
  name: string
  accent: string
  state: RoomState
  /** Items placed since the room was last looked at (keys from `itemKey`). */
  newItems: string[]
  /** The shell tier reached since the room was last looked at, if it changed. */
  newShell: ShellTier | null
  /** Where each earned item stands after the user's placements. */
  placed: ResolvedItem[]
  /** Earned items not in the room right now, with the reason. */
  inventory: InventoryItem[]
  decay: RoomState['decay']
  /** For the room editor, which has no catalog of its own: free slots per earned item, art variants per item. */
  editor: { targets: Record<string, string[]>; variants: Record<string, string[]> }
}

export interface PalaceView {
  today: LocalDay
  rooms: PalaceRoom[]
  /** The same rooms laid out on the one connected floor, for the canvas. */
  floor: FloorView
}

export const itemKey = (item: PlacedItem): string => `${item.item}@${item.slot}#${item.index}`

const SHELL_KEY_PREFIX = 'shell:'

/** Everything about a room that counts as "already seen", to store between visits. */
export function seenKeys(state: RoomState): string[] {
  return [...[...state.items, ...state.replaced].map(itemKey), `${SHELL_KEY_PREFIX}${state.shell}`]
}

/**
 * What the room has gained since `seen` was stored. A room never looked at
 * (`seen` null) reports nothing: its starting furniture is not news.
 */
export function newSince(seen: readonly string[] | null, state: RoomState): { items: string[]; shell: ShellTier | null } {
  if (seen === null) return { items: [], shell: null }
  const known = new Set(seen)
  const items = state.items.map(itemKey).filter((key) => !known.has(key))
  const hadShell = seen.some((key) => key.startsWith(SHELL_KEY_PREFIX))
  const shell = hadShell && !known.has(`${SHELL_KEY_PREFIX}${state.shell}`) && state.shell !== 'bare' ? state.shell : null
  return { items, shell }
}

export function buildPalace(input: {
  catalog: Catalog
  rows: HistoryRows
  timeZone: string
  today: LocalDay
  /** Per room id, the keys stored at the last visit; missing or null = never visited. */
  seen: Readonly<Record<string, readonly string[] | null | undefined>>
  /** The user's arrangement (`placements` rows); none means every item in its catalog slot. */
  placements?: readonly Placement[]
  /** The room zoomed into, whose back walls rise and show what hangs on them. */
  focus?: string | null
  /** What each room already earned (`room_progress`); unlocks never drop below it. */
  kept?: Readonly<Record<string, KeptProgress>>
}): PalaceView {
  const events = buildRoomEvents(input.rows, input.timeZone)
  const rooms = Object.values(input.catalog.rooms).map((room) => {
    const state = computeRoomState(room.id, events, input.catalog, input.today, input.kept?.[room.id])
    const fresh = newSince(input.seen[room.id] ?? null, state)
    const resolved = resolvePlacements(state, input.placements ?? [], input.catalog)
    const earned = [...resolved.placed.map((p) => p.instance), ...resolved.inventory.map((i) => i.instance)]
    const items = new Set([...resolved.placed.map((p) => p.item), ...resolved.inventory.map((i) => i.item)])
    const editor = {
      targets: Object.fromEntries(earned.map((instance) => [instance, dropTargets(instance, resolved, input.catalog)])),
      variants: Object.fromEntries([...items].map((item) => [item, input.catalog.items[item]?.variants ?? []]))
    }
    return {
      editor,
      id: room.id,
      name: room.name,
      accent: room.accent,
      state,
      newItems: fresh.items,
      newShell: fresh.shell,
      placed: resolved.placed,
      inventory: resolved.inventory,
      decay: state.decay
    }
  })
  const floorRooms = rooms.map((r) => ({ ...r, decay: r.decay.level }))
  return { today: input.today, rooms, floor: buildFloor(input.catalog, floorRooms, input.focus ?? null) }
}

const SPECIAL_LABELS: Record<string, string> = {
  trophy: 'Trophy',
  trophy_shelf: 'Trophy shelf',
  window: 'Window',
  cardboard_box: 'Cardboard box'
}

/** A readable name for a catalog item id: `base_bookshelf_low` → "Low bookshelf", `coding_rack` → "Rack". */
export function itemLabel(itemId: string, roomIds: readonly string[] = []): string {
  const special = SPECIAL_LABELS[itemId]
  if (special) return special
  let name = itemId
  for (const prefix of ['base', 'mail', ...roomIds]) {
    if (name.startsWith(`${prefix}_`)) {
      name = name.slice(prefix.length + 1)
      break
    }
  }
  const words = name.split('_')
  // `bookshelf_low`, `plant_small`: the size reads better in front.
  const last = words[words.length - 1]!
  if (words.length > 1 && ['low', 'tall', 'small', 'large'].includes(last)) words.unshift(words.pop()!)
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const SHELL_LABEL: Record<ShellTier, string> = {
  bare: 'Bare room',
  painted: 'Painted room',
  finished: 'Finished room'
}

/** What the next milestone on a track gives, in words. */
export function rewardText(next: NextUnlock, roomIds: readonly string[] = []): string {
  const parts = next.rewards.map((reward) =>
    reward.type === 'shell' ? SHELL_LABEL[reward.shell].toLowerCase() : itemLabel(reward.item, roomIds).toLowerCase()
  )
  if (parts.length === 0) return 'nothing new'
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export interface TrackProgress {
  track: Track
  /** The current streak in days, or the counted goals. */
  value: number
  /** The milestone being worked towards; null when the ladder is complete. */
  target: number | null
  /** 0 to 1: `value` out of `target`, matching the "5 days of 8" shown beside the bar. */
  fraction: number
  /** One line under the bar. */
  caption: string
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function trackProgress(state: RoomState, track: Track, roomIds: readonly string[] = []): TrackProgress {
  const next = state.nextUnlock[track]
  const value = track === 'streak' ? state.streak.current : state.goals.count
  if (next === null) {
    return { track, value, target: null, fraction: 1, caption: 'Everything on this track is unlocked.' }
  }
  // A streak milestone is judged on the best run, but the bar shows the run in progress.
  const fraction = Math.min(1, Math.max(0, value / next.at))
  const need =
    track === 'streak'
      ? `${plural(next.remaining, 'more day')} in a row`
      : `${plural(next.remaining, 'more finished project')}`
  return { track, value, target: next.at, fraction, caption: `${need} for the ${rewardText(next, roomIds)}.` }
}

/** True when the room already has a chat day today: its streak is being fed right now. */
export function activeToday(state: RoomState): boolean {
  return state.streak.lastRoomDay === state.today
}

/**
 * The room the person was last working in: the room of the chat with the most
 * recent message, among rooms that exist. Null when nothing has been sorted yet.
 */
export function currentRoomOf(
  chats: ReadonlyArray<{ roomId: string | null; lastMessageAt: string | null; createdAt: string }>,
  roomIds: readonly string[]
): string | null {
  let best: { roomId: string; at: string } | null = null
  for (const chat of chats) {
    if (chat.roomId === null || !roomIds.includes(chat.roomId)) continue
    const at = chat.lastMessageAt ?? chat.createdAt
    if (best === null || at > best.at) best = { roomId: chat.roomId, at }
  }
  return best?.roomId ?? null
}

const DECAY_WORD: Record<1 | 2 | 3 | 4, string> = { 1: 'Dusty', 2: 'Cobwebs', 3: 'Mostly dark', 4: 'Dark' }

/** What a room's decay means, in words, or null when the room is clean. */
export function decayText(decay: RoomState['decay'], projectTitle: string | null): string | null {
  if (decay.level === 0) return null
  return `${DECAY_WORD[decay.level]}: ${decay.weekdaysQuiet} quiet weekdays on ${projectTitle ?? 'its quietest project'}`
}
