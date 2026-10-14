// The safelight blush's life (1.7, Bradley 2026-10-11): when it lights, what the bubble says, when
// it lapses; the haemorrhage that turns the whole creature red; the lamp test. Display only: none
// of it approves or blocks anything. Pure: time and ids are arguments.

import type { Blush, Haemorrhage } from '../types'
import { rowCount } from './classify'
import type { Undo } from './irreversible'
import { returningWrites } from './irreversible'
import { REFUSAL_MS } from './refusal'

/** The floor: the blush stays this long after the result, so a call under a second is still seen. */
export const BLUSH_MS = 4_000
/** A call in flight keeps its blush for at most this long, should its result never come. */
export const BLUSH_FLIGHT_MS = 10 * 60_000
/** The lamp test at session start: every warning lamp lit for a moment, to prove the red channel. */
export const LAMP_MS = 1_500
/** The bubble's header for a blush. */
export const BLUSH_HEADER = 'SAFELIGHT'

const WORDS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'you can undo it',
  2: "undo won't get it all back",
  3: 'nobody can undo it',
}

/** Amber below red (1.10.0): rung 1, "you can undo it", draws amber; rungs 2 and 3 stay red. */
export const blushLevel = (rung: number): 'amber' | 'red' => (rung === 1 ? 'amber' : 'red')

/** The bubble's text: `<rung words>: <what> - <undo>`. */
export function blushText(u: Undo): string {
  return `${blushWhy(u)} - ${u.undo}`
}

/** The red log's why (1.10.0): `<rung words>: <what>`; the undo is logged once, as the fix. */
export function blushWhy(u: Undo): string {
  return `${WORDS[u.rung]}: ${u.what}`
}

/** A blush lit as the call goes out; it holds until the result comes (or the flight ceiling). */
export function blushFor(u: Undo, now: number, noticeId: string): Blush {
  return { rung: u.rung, text: blushText(u), at: now, until: now + BLUSH_FLIGHT_MS, noticeId }
}

/** The blush once the result is in: the floor runs from now. */
export function blushLanded(b: Blush, now: number): Blush {
  return { ...b, until: now + BLUSH_MS }
}

export function blushLive(b: Blush | null | undefined, now: number): boolean {
  return b !== null && b !== undefined && b.until > now
}

/** The lamp test is showing while its end lies ahead. */
export function lampLive(until: number | null | undefined, now: number): boolean {
  return typeof until === 'number' && until > now
}

export type HaemorrhageInput = {
  query: string
  /** What came back from the database tool. */
  resultText: string
  /** Rows above which, and above what the statement named, the creature goes red (config). */
  threshold: number
}

/**
 * Far more rows came back than the statement named: an UPDATE or DELETE with RETURNING whose
 * result holds more rows than it pinned (1 for a single key, the length of an IN list, else 1) and
 * more than the threshold. An unreadable result counts nothing: unknown is never a haemorrhage.
 */
export function haemorrhageFrom(i: HaemorrhageInput, now: number, noticeId: string): Haemorrhage | null {
  const rows = rowCount(i.resultText)
  if (rows === null) return null
  const writes = returningWrites(i.query)
  if (writes.length === 0) return null
  const named = Math.max(...writes.map((w) => w.named))
  if (rows <= named || rows <= i.threshold) return null
  return { rows, named, table: writes[0]?.table ?? '', at: now, until: now + REFUSAL_MS, noticeId }
}

/** The bubble's header and text for a haemorrhage. */
export function haemorrhageNotice(h: Haemorrhage): { header: string; text: string } {
  return {
    header: 'HAEMORRHAGE',
    text: `${h.rows} rows came back from a statement that named ${h.named} (${h.table}). The witness did not hold it; check what it touched.`,
  }
}

export function haemorrhageLive(h: Haemorrhage | null | undefined, now: number): boolean {
  return h !== null && h !== undefined && h.until > now
}
