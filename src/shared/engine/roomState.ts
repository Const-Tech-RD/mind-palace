import type { Catalog, LadderStep, RoomDef, Rules, ShellTier } from '../catalog/schema'
import { SHELL_TIERS, WEEKDAYS } from '../catalog/schema'
import { dayFromNumber, dayNumber, weekdayIndex, weekdaysBetween, type LocalDay } from './days'
import type { DecayLevel, KeptProgress, NextUnlock, PlacedItem, Reward, RoomEvent, RoomState, Track } from './types'

/**
 * The progression engine: a pure function from the event history to what a
 * room looks like. No database, no system clock - `today` is always passed in.
 *
 * Rules implemented (plan, "Core logic"):
 *  - A room day is a local day with at least one user message in the room.
 *  - Walking back from today, a weekday without a room day ends the run; grace
 *    weekdays (Saturday and Sunday by default) never end it and only add to it
 *    when there was a chat. Today without a chat yet does not end the run.
 *  - Each streak milestone unlocks once and for good: unlocks are judged
 *    against the longest run ever, not the current one.
 *  - Goals count at most once per local day; every counted completion adds a
 *    trophy up to the maximum.
 */
export function computeRoomState(
  roomId: string,
  events: readonly RoomEvent[],
  rules: Catalog,
  today: LocalDay,
  /** What the room already earned; unlocks never drop below it. */
  kept: KeptProgress = { bestStreak: 0, goalCount: 0 }
): RoomState {
  const room = rules.rooms[roomId]
  if (!room) {
    throw new Error(`Unknown room "${roomId}" (catalog has: ${Object.keys(rules.rooms).join(', ')})`)
  }
  const r = rules.rules
  const todayNum = dayNumber(today)

  const roomDays = new Set<number>()
  const goalDays = new Set<number>()
  let completions = 0
  const projects: Array<Extract<RoomEvent, { kind: 'project' }>> = []
  for (const event of events) {
    if (event.roomId !== roomId) continue
    if (event.kind === 'project') {
      projects.push(event)
      continue
    }
    const n = dayNumber(event.localDay)
    // Days after `today` can only come from a clock or timezone change; they
    // have not happened yet on this calendar, so they are left out.
    if (n > todayNum) continue
    if (event.kind === 'user_message') roomDays.add(n)
    else {
      completions += 1
      goalDays.add(n)
    }
  }

  const derived = computeStreak(roomDays, todayNum, graceSet(r))
  const streak = { ...derived, best: Math.max(derived.best, kept.bestStreak) }
  const goalCount = goalDays.size
  // Unlocks on the goal track are judged against the most goals ever counted.
  const goalsReached = Math.max(goalCount, kept.goalCount)

  const trophyRule = r.tracks.goals.every_completion
  const trophyCapacity = r.layout.slots[trophyRule.slot]?.capacity ?? 1
  const trophies = Math.min(goalsReached, trophyRule.max, trophyCapacity)

  const { items, replaced, shell } = placeItems(r, room, streak.best, goalsReached, trophies)

  return {
    roomId,
    today,
    streak: {
      current: streak.current,
      best: streak.best,
      lastRoomDay: streak.last === null ? null : dayFromNumber(streak.last),
      milestonesReached: r.tracks.streak.milestones.filter((m) => m <= streak.best)
    },
    goals: {
      count: goalCount,
      completions,
      milestonesReached: r.tracks.goals.milestones.filter((m) => m <= goalsReached),
      trophies
    },
    shell,
    items,
    replaced,
    decay: decayOf(projects, today),
    nextUnlock: {
      streak: nextUnlock(r, room, 'streak', streak.best, streak.current),
      goals: nextUnlock(r, room, 'goals', goalsReached, goalCount)
    }
  }
}

function graceSet(rules: Rules): ReadonlySet<number> {
  return new Set(rules.tracks.streak.grace_weekdays.map((name) => WEEKDAYS.indexOf(name)))
}

interface Streak {
  current: number
  best: number
  last: number | null
}

function computeStreak(roomDays: ReadonlySet<number>, todayNum: number, grace: ReadonlySet<number>): Streak {
  const days = [...roomDays].sort((a, b) => a - b)
  /** True when every day strictly between `from` and `to` is a grace day. */
  const gapIsForgiven = (from: number, to: number): boolean => {
    for (let d = from + 1; d < to; d++) if (!grace.has(weekdayIndex(d))) return false
    return true
  }

  let run = 0
  let best = 0
  let previous: number | null = null
  for (const day of days) {
    run = previous !== null && gapIsForgiven(previous, day) ? run + 1 : 1
    if (run > best) best = run
    previous = day
  }

  // The run is still alive if nothing but grace days lies between the last room
  // day and today. Today itself is never checked: no chat yet does not end it.
  const current = previous !== null && gapIsForgiven(previous, todayNum) ? run : 0
  return { current, best, last: previous }
}

function shellRank(tier: ShellTier): number {
  return SHELL_TIERS.indexOf(tier)
}

function stepRewards(step: LadderStep, room: RoomDef): Reward[] {
  if (step.shell !== undefined) return [{ type: 'shell', shell: step.shell }]
  if (step.signature !== undefined) {
    return room.signature
      .filter((s) => s.n === step.signature)
      .map((s) => ({
        type: 'item' as const,
        item: s.item,
        slots: [...s.slots],
        signature: s.n,
        replaces: s.replaces ?? null
      }))
  }
  if (step.item !== undefined && step.slot !== undefined) {
    return [{ type: 'item', item: step.item, slots: [step.slot], signature: null, replaces: step.replaces ?? null }]
  }
  return []
}

function placeItems(
  rules: Rules,
  room: RoomDef,
  bestStreak: number,
  goalCount: number,
  trophies: number
): { items: PlacedItem[]; replaced: PlacedItem[]; shell: ShellTier } {
  const placed: PlacedItem[] = []
  let shell: ShellTier = 'bare'

  for (const start of rules.base_ladder.start) {
    placed.push({ item: start.item, slot: start.slot, index: 0, source: 'start', at: null, signature: null, replaces: null })
  }
  for (const sig of room.signature) {
    if (sig.unlock !== 'start') continue
    for (const slot of sig.slots) {
      placed.push({ item: sig.item, slot, index: 0, source: 'start', at: null, signature: sig.n, replaces: sig.replaces ?? null })
    }
  }

  const tracks: Array<[Track, number]> = [
    ['streak', bestStreak],
    ['goals', goalCount]
  ]
  for (const [track, reached] of tracks) {
    for (const step of rules.base_ladder[track]) {
      if (step.at > reached) continue
      for (const reward of stepRewards(step, room)) {
        if (reward.type === 'shell') {
          if (shellRank(reward.shell) > shellRank(shell)) shell = reward.shell
          continue
        }
        for (const slot of reward.slots) {
          placed.push({
            item: reward.item,
            slot,
            index: 0,
            source: track,
            at: step.at,
            signature: reward.signature,
            replaces: reward.replaces
          })
        }
      }
    }
  }

  // A replacement wins whatever order the two tracks were climbed in: if the
  // large plant (13 goals) is already there, the small plant (13-day streak)
  // never appears next to it.
  const pushedOut = new Set(placed.filter((p) => p.replaces !== null).map((p) => `${p.replaces}@${p.slot}`))
  const items = placed.filter((p) => !pushedOut.has(`${p.item}@${p.slot}`))
  const replaced = placed.filter((p) => pushedOut.has(`${p.item}@${p.slot}`))

  const trophyRule = rules.tracks.goals.every_completion
  for (let i = 0; i < trophies; i++) {
    items.push({
      item: trophyRule.item,
      slot: trophyRule.slot,
      index: i,
      source: 'trophy',
      at: i + 1,
      signature: null,
      replaces: null
    })
  }

  return { items, replaced, shell }
}

/**
 * The lowest threshold on the track that has not been reached yet. For the
 * streak that is "reached" by the longest run ever; `progress` is the number
 * `remaining` is measured from (the current streak, or the goal count).
 */
function nextUnlock(rules: Rules, room: RoomDef, track: Track, reached: number, progress: number): NextUnlock | null {
  const milestones = rules.tracks[track].milestones
  const thresholds = new Set<number>(milestones)
  for (const step of rules.base_ladder[track]) thresholds.add(step.at)

  const at = [...thresholds].filter((t) => t > reached).sort((a, b) => a - b)[0]
  if (at === undefined) return null

  return {
    track,
    at,
    remaining: at - progress,
    milestone: milestones.includes(at),
    rewards: rules.base_ladder[track].filter((step) => step.at === at).flatMap((step) => stepRewards(step, room))
  }
}

/** Weekdays without activity at which each decay level starts (plan v2: dusty, cobwebs, mostly dark, dark). */
export const DECAY_THRESHOLDS = [7, 14, 21, 30] as const

/**
 * The room's decay comes from its quietest active project. A room with no
 * active project never decays, and furniture is never removed by it.
 */
function decayOf(projects: ReadonlyArray<Extract<RoomEvent, { kind: 'project' }>>, today: LocalDay): RoomState['decay'] {
  let quietest: RoomState['decay'] = { level: 0, weekdaysQuiet: 0, projectId: null }
  for (const project of projects) {
    if (project.state !== 'active') continue
    const quiet = project.lastActivityDay === null ? 0 : weekdaysBetween(project.lastActivityDay, today)
    if (quietest.projectId === null || quiet > quietest.weekdaysQuiet) {
      const level = DECAY_THRESHOLDS.filter((t) => quiet >= t).length as DecayLevel
      quietest = { level, weekdaysQuiet: quiet, projectId: project.projectId }
    }
  }
  return quietest
}
