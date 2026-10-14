// Carry-over per session (1.2, ruled by Bradley 2026-10-09). Until now one slot per project held
// the leftover asks, rewritten after every turn: with several sessions open in one repository a
// new session took another LIVE session's undone asks as its own carried work, and whichever
// turn ended last overwrote the slot (seen live in S170, and named by a side agent's note).
// Ruled: each session keeps its leftovers in a slot of its own, and a starting session takes only
// the slots of sessions that have ENDED (written at their end, or untouched for hours: a crash),
// merged, one hop as before. A live session's slot is never taken and never overwritten. Pure.

import type { Ask } from '../types'
import { normalise } from './asks'

/** A slot untouched this long is a session that ended without saying so (a crash, a closed window). */
export const CARRY_STALE_MS = 6 * 60 * 60_000

/** One session's leftovers, under `carry:<project>:<session id>`. */
export type CarrySlot = { v: 2; sessionId: string; savedAt: number; ended: boolean; asks: Ask[] }

export const carryPrefix = (project: string): string => `carry:${project}:`
export const carrySlotKey = (project: string, sessionId: string): string => `${carryPrefix(project)}${sessionId}`

export function carrySlot(o: { sessionId: string; savedAt: number; ended: boolean; asks: readonly Ask[] }): CarrySlot {
  return { v: 2, sessionId: o.sessionId, savedAt: o.savedAt, ended: o.ended, asks: o.asks.map(a => ({ ...a })) }
}

/** A stored slot read back; null for anything else (the older single slot is a bare list, read apart). */
export function asCarrySlot(v: unknown): CarrySlot | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.v !== 2 || typeof o.sessionId !== 'string' || typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
  if (typeof o.ended !== 'boolean' || !Array.isArray(o.asks)) return null
  return carrySlot({ sessionId: o.sessionId, savedAt: o.savedAt, ended: o.ended, asks: o.asks as Ask[] })
}

/** Whether a starting session may take this slot: another session's, ended or gone stale. */
export function takeable(slot: CarrySlot, now: number, self: string): boolean {
  return slot.sessionId !== self && (slot.ended || now - slot.savedAt > CARRY_STALE_MS)
}

/**
 * A session's OWN slot read back (1.3.6, F9, 2026-10-11: the laptop restarted, and the resumed
 * conversation ran with an empty ledger while its own slot, never ended, sat stranded): the slot's
 * asks this session does not already hold, by their text. A resumed process holds none and takes
 * them all; a hot reload in the same process holds them all and takes none.
 */
export function ownLeftovers(slot: readonly Ask[], held: readonly Ask[]): Ask[] {
  const have = new Set(held.map(a => normalise(a.text)))
  return slot.filter(a => !have.has(normalise(a.text))).map(a => ({ ...a }))
}

/** Leftovers from several ended sessions as one list, the same ask (by its text) once. */
export function mergeCarried(lists: ReadonlyArray<readonly Ask[]>): Ask[] {
  const seen = new Set<string>()
  const out: Ask[] = []
  for (const a of lists.flat()) {
    const k = normalise(a.text)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...a })
  }
  return out
}
