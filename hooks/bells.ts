import type { Activity } from '../types'

export const BREAK_MS = 5 * 60_000
/** Half a bell: thirty minutes of active time (1.1, Bradley's sketch of 2026-10-09). */
export const HALF_BELL_MS = 30 * 60_000
/** A whole bell: an hour of active time. */
export const BELL_MS = 2 * HALF_BELL_MS
/** Three bells on the chime, an hour each, filling from the bottom. */
export const BELLS = 3
export const MAX_HALVES = 2 * BELLS

/** Count an interaction at `at`: a gap of five minutes or less is active time. */
export function touch(activity: Activity, at: number): Activity {
  const gap = activity.lastAt === null ? 0 : at - activity.lastAt
  const counted = activity.lastAt !== null && gap >= 0 && gap <= BREAK_MS ? gap : 0
  return { activeMs: activity.activeMs + counted, lastAt: at }
}

/** Half-bells of active time, one per thirty minutes, capped at the chime's six. */
export function bellHalves(activity: Activity): number {
  return Math.min(MAX_HALVES, Math.floor(activity.activeMs / HALF_BELL_MS))
}

/** Whole bells rung: one per hour of active time, capped at three. */
export function bellsRung(activity: Activity): number {
  return Math.floor(bellHalves(activity) / 2)
}

export function isIdle(activity: Activity, now: number): boolean {
  return activity.lastAt !== null && now - activity.lastAt > BREAK_MS
}
