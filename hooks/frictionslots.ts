// Friction per session (1.2, ruled by Bradley 2026-10-09, after the carry ruling). One slot per
// project held the friction log, rewritten after every turn from what each session loaded at its
// start plus its own: with several pods open in one repository, the last writer won and the
// others' friction was lost (seen live, S170: three entries survived a day of five pods), so the
// barnacles undercounted. Now each session writes ONLY its own friction, to a slot of its own;
// every session READS all the project's slots, live or ended (friction is history, not work to
// take); and slots nobody has touched for a day are folded into the project's archive slot (the
// old single key) and deleted, so the store stays bounded. Pure.

import type { Friction } from '../types'
import { FRICTION_CAP } from './barnacles'

/** A session's slot untouched this long is folded into the archive at the next start. */
export const FRICTION_ARCHIVE_MS = 24 * 60 * 60_000

/** One session's own friction, under `friction:<project>:<session id>`. */
export type FrictionSlot = { v: 2; sessionId: string; savedAt: number; entries: Friction[] }

export const frictionPrefix = (project: string): string => `friction:${project}:`
export const frictionSlotKey = (project: string, sessionId: string): string => `${frictionPrefix(project)}${sessionId}`

export function frictionSlot(o: { sessionId: string; savedAt: number; entries: readonly Friction[] }): FrictionSlot {
  return { v: 2, sessionId: o.sessionId, savedAt: o.savedAt, entries: o.entries.slice(-FRICTION_CAP).map(f => ({ ...f })) }
}

const isFriction = (f: unknown): f is Friction =>
  f !== null &&
  typeof f === 'object' &&
  typeof (f as Friction).kind === 'string' &&
  typeof (f as Friction).key === 'string' &&
  typeof (f as Friction).at === 'number' &&
  typeof (f as Friction).detail === 'string'

/** An entry as stored: a `session` that is not a non-empty string is dropped (legacy: the unknown session). */
const cleanFriction = (f: Friction): Friction => {
  const { session, ...rest } = f
  return typeof session === 'string' && session !== '' ? { ...rest, session } : { ...rest }
}

/** A stored list of friction (the archive, or the old single slot), malformed entries dropped. */
export const asFrictionList = (v: unknown): Friction[] => (Array.isArray(v) ? v.filter(isFriction).map(cleanFriction) : [])

/** Entries with no session take the slot's: a slot knows whose it is (1.9). Entries already stamped keep theirs. */
export const stampSession = (entries: readonly Friction[], session: string): Friction[] =>
  entries.map(f => (f.session === undefined ? { ...f, session } : { ...f }))

/** A stored slot read back; null for anything else. */
export function asFrictionSlot(v: unknown): FrictionSlot | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.v !== 2 || typeof o.sessionId !== 'string' || typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
  return frictionSlot({ sessionId: o.sessionId, savedAt: o.savedAt, entries: asFrictionList(o.entries) })
}

/** Whether a slot is folded into the archive: another session's, untouched for a day. */
export const archivable = (slot: FrictionSlot, now: number, self: string): boolean =>
  slot.sessionId !== self && now - slot.savedAt > FRICTION_ARCHIVE_MS

const entryKey = (f: Friction): string => `${f.kind}\u0000${f.key}\u0000${f.at}\u0000${f.detail}`

/** Several logs as one, oldest first, each entry once, the newest FRICTION_CAP kept. */
export function mergeFriction(lists: ReadonlyArray<readonly Friction[]>): Friction[] {
  const seen = new Set<string>()
  const out: Friction[] = []
  for (const f of lists.flat()) {
    const k = entryKey(f)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...f })
  }
  return out.sort((a, b) => a.at - b.at).slice(-FRICTION_CAP)
}

/** What this session writes to its own slot: the friction recorded since it started. */
export const ownFriction = (log: readonly Friction[], since: number): Friction[] => log.filter(f => f.at >= since).map(f => ({ ...f }))
