import { SHELL_TIERS } from '../catalog/schema'
import type { PlacedItem, RoomState, UnlockEvent } from './types'

const key = (p: PlacedItem): string => `${p.item}@${p.slot}#${p.index}`

/**
 * What is new in `next` compared with `previous` - the input for the "new
 * item" toast. Pure: both states come from `computeRoomState`, typically for
 * yesterday and today, or for before and after an action.
 *
 * Only gains are reported. Items that disappeared (a reopened goal, a chat
 * moved to another room) produce no event, and neither does an older item that
 * comes back into view because its replacement was lost.
 */
export function diffRoomStates(previous: RoomState, next: RoomState): UnlockEvent[] {
  if (previous.roomId !== next.roomId) {
    throw new Error(`Cannot diff states of different rooms ("${previous.roomId}" and "${next.roomId}")`)
  }
  const events: UnlockEvent[] = []

  if (SHELL_TIERS.indexOf(next.shell) > SHELL_TIERS.indexOf(previous.shell)) {
    events.push({ kind: 'shell', roomId: next.roomId, shell: next.shell, previous: previous.shell })
  }

  const had = new Set([...previous.items, ...previous.replaced].map(key))
  for (const item of next.items) {
    if (!had.has(key(item))) events.push({ kind: 'item', roomId: next.roomId, ...item })
  }
  return events
}
