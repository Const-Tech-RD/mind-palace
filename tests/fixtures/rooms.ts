import type { RoomDef } from '../../src/shared/catalog'

/**
 * The three placeholder rooms the catalog used to ship, rebuilt from library
 * items for the tests. Their cells put them where they always stood: Coding at
 * the back, Art on the right, Music on the left, the Mail room in front.
 */
const room = (def: Omit<RoomDef, 'assets' | 'not_here'> & { not_here?: string }): RoomDef => ({ not_here: '', assets: {}, ...def })

export const CODING = room({
  id: 'coding',
  name: 'Coding room',
  area: 'software',
  accent: 'mp-room-accent-0',
  cell: [-1, -1],
  belongs: 'Programming, apps, scripts, servers, data and anything about software.',
  examples: ['My Python script throws KeyError when I read the CSV header'],
  signature: [
    { n: 1, unlock: 'start', item: 'coding_laptop', slots: ['desk_center'] },
    { n: 2, unlock: 'streak', item: 'coding_monitor', slots: ['desk_center'], replaces: 'coding_laptop' },
    { n: 3, unlock: 'streak', item: 'coding_whiteboard', slots: ['wall_right_b'] },
    { n: 4, unlock: 'streak', item: 'coding_rack', slots: ['corner_right'] },
    { n: 5, unlock: 'streak', item: 'coding_arcade', slots: ['floor_right'] }
  ]
})

export const MUSIC = room({
  id: 'music',
  name: 'Music studio',
  area: 'music',
  accent: 'mp-room-accent-1',
  cell: [-1, 0],
  belongs: 'Making, playing, recording and learning music.',
  examples: ['How do I get a warmer vocal sound?'],
  signature: [
    { n: 1, unlock: 'start', item: 'music_mic', slots: ['beside_seat'] },
    { n: 2, unlock: 'streak', item: 'music_speakers', slots: ['desk_left', 'desk_right'] },
    { n: 3, unlock: 'streak', item: 'music_keyboard', slots: ['floor_right'] },
    { n: 4, unlock: 'streak', item: 'music_guitar', slots: ['corner_right'] },
    { n: 5, unlock: 'streak', item: 'music_mixer', slots: ['desk_center'] }
  ]
})

export const ART = room({
  id: 'art',
  name: 'Art workshop',
  area: 'art',
  accent: 'mp-room-accent-2',
  cell: [0, -1],
  belongs: 'Drawing, painting, design and crafts.',
  examples: ['Help me pick a palette for a poster'],
  signature: [
    { n: 1, unlock: 'start', item: 'art_sketchbook', slots: ['desk_center'] },
    { n: 2, unlock: 'streak', item: 'art_easel', slots: ['corner_right'] },
    { n: 3, unlock: 'streak', item: 'art_paint_cart', slots: ['beside_seat'] },
    { n: 4, unlock: 'streak', item: 'art_pegboard', slots: ['wall_right_b'] },
    { n: 5, unlock: 'streak', item: 'art_pottery_wheel', slots: ['floor_right'] }
  ]
})

export const FIXTURE_ROOMS = [CODING, MUSIC, ART] as const
