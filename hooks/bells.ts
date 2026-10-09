import type { Activity } from '../types'

export const BREAK_MS = 5 * 60_000
export const BELL_MS = 30 * 60_000

/** Count an interaction at `at`: a gap of five minutes or less is active time. */
export function touch(activity: Activity, at: number): Activity {
  const gap = activity.lastAt === null ? 0 : at - activity.lastAt
  const counted = activity.lastAt !== null && gap >= 0 && gap <= BREAK_MS ? gap : 0
  return { activeMs: activity.activeMs + counted, lastAt: at }
}

export function bellsRung(activity: Activity): number {
  return Math.min(4, Math.floor(activity.activeMs / BELL_MS))
}

export function isIdle(activity: Activity, now: number): boolean {
  return activity.lastAt !== null && now - activity.lastAt > BREAK_MS
}
