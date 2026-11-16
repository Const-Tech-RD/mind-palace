import type { Weekday } from '../catalog/schema'
import { WEEKDAYS } from '../catalog/schema'

/**
 * Calendar-day helpers. Nothing here reads the system clock or the machine's
 * timezone: a day is a `YYYY-MM-DD` string, and converting an instant to a day
 * always takes an explicit IANA timezone.
 */

/** A local calendar day, `YYYY-MM-DD`. */
export type LocalDay = string

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** Days since 1970-01-01 for a `YYYY-MM-DD` day. Throws on a malformed or impossible date. */
export function dayNumber(day: LocalDay): number {
  const m = DAY_RE.exec(day)
  if (!m) throw new Error(`Invalid local day "${day}" (expected YYYY-MM-DD)`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Invalid local day "${day}" (no such date)`)
  }
  return ms / MS_PER_DAY
}

export function dayFromNumber(n: number): LocalDay {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
}

export function addDays(day: LocalDay, delta: number): LocalDay {
  return dayFromNumber(dayNumber(day) + delta)
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayIndex(dayNum: number): number {
  return (((dayNum + 4) % 7) + 7) % 7
}

/** Monday-to-Friday days after `from`, up to and including `to` (0 when `to` is not later). */
export function weekdaysBetween(from: LocalDay, to: LocalDay): number {
  let count = 0
  for (let n = dayNumber(from) + 1; n <= dayNumber(to); n++) {
    const weekday = weekdayIndex(n)
    if (weekday >= 1 && weekday <= 5) count += 1
  }
  return count
}

export function weekdayOf(day: LocalDay): Weekday {
  return WEEKDAYS[weekdayIndex(dayNumber(day))]!
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The calendar day of a UTC instant in the given IANA timezone
 * (for example `America/Santo_Domingo`). Throws on an invalid instant or zone.
 */
export function localDayOf(instant: string | Date, timeZone: string): LocalDay {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp "${String(instant)}"`)
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    formatters.set(timeZone, fmt)
  }
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}`
}
