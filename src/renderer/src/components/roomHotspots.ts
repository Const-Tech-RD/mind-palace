/**
 * The things in each painted room that can be clicked, and what each one is
 * for. `at` is where the thing is in the painting, in logical pixels from the
 * room's back floor corner (the same space the canvas draws in), read off the
 * cut-outs by eye.
 */
export type HotspotKind = 'chat' | 'projects' | 'finished' | 'chats' | 'unsorted' | 'reminders' | 'exit'

export interface Hotspot {
  id: string
  kind: HotspotKind
  /** What the thing is, for the tooltip and for screen readers. */
  thing: string
  at: readonly [number, number]
}

/** What clicking each kind does, in a few words. */
export const HOTSPOT_ACTION: Record<HotspotKind, string> = {
  chat: 'Start a chat here',
  projects: 'Projects in progress',
  finished: 'Finished projects',
  chats: 'Recent chats',
  unsorted: 'Chats waiting to be sorted',
  reminders: 'Reminders waiting',
  exit: 'Back to the palace'
}

export const ROOM_HOTSPOTS: Record<string, Hotspot[]> = {
  coding: [
    { id: 'desk', kind: 'chat', thing: 'The desk', at: [-102, 128] },
    { id: 'whiteboard', kind: 'projects', thing: 'The whiteboard', at: [142, -28] },
    { id: 'jacket', kind: 'finished', thing: 'The stage jacket', at: [53, -22] },
    { id: 'screens', kind: 'chats', thing: 'The wall of screens', at: [-128, -7] }
  ],
  music: [
    { id: 'drums', kind: 'chat', thing: 'The drum kit', at: [131, 75] },
    { id: 'keyboard', kind: 'projects', thing: 'The keyboard', at: [-35, 163] },
    { id: 'guitar', kind: 'finished', thing: 'The guitar on the wall', at: [105, -50] },
    { id: 'booth', kind: 'chats', thing: 'The recording booth', at: [-123, 18] }
  ],
  art: [
    { id: 'easel', kind: 'chat', thing: 'The easel', at: [-159, 17] },
    { id: 'table', kind: 'projects', thing: 'The drafting table', at: [111, 17] },
    { id: 'sketches', kind: 'finished', thing: 'The pinned sketches', at: [-82, -87] },
    { id: 'shelves', kind: 'chats', thing: 'The shelves', at: [-61, -30] }
  ],
  mailroom: [
    { id: 'writing-desk', kind: 'chat', thing: 'The writing desk', at: [79, 123] },
    { id: 'table', kind: 'projects', thing: 'The sorting table', at: [-71, 76] },
    { id: 'crates', kind: 'finished', thing: 'The packed crates', at: [2, 191] },
    { id: 'pigeonholes', kind: 'unsorted', thing: 'The pigeonholes', at: [-128, 4] },
    { id: 'bell', kind: 'reminders', thing: 'The bell', at: [194, 11] },
    { id: 'door', kind: 'exit', thing: 'The door', at: [137, -7] }
  ]
}
