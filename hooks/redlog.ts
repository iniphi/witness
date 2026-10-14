// The red log (1.10.0, ruled by Bradley 2026-10-11): "are we tracking and logging when the safelight
// comes on, why it comes on and what the fix is?" Every safelight event is recorded: when, which
// channel, how red, why (the bubble's text), the fix, and how it ended. Each session keeps its own
// slot `reds:<project>:<session id>` (as routines.ts does), every session reads them all, and a slot
// untouched for a week is dropped, so the store stays bounded.
//
// What an event holds is the fields below and nothing else: never an SQL statement beyond what the
// bubble already shows, never a path, never an id beyond the session tag. Pure: time is an argument.

import { sessionTag } from './notes'

export type RedChannel = 'lamp' | 'blush' | 'hold' | 'refusal' | 'haemorrhage'
export type RedLevel = 'amber' | 'red'
export type RedHow = 'lapsed' | 'cleared' | 'answered' | 'failed' | 'burst'

/** One safelight event. `endedAt` and `how` are absent while it is still showing. */
export type RedEvent = {
  id: string
  at: number
  channel: RedChannel
  level: RedLevel
  /** The blush's rung, where the channel is a blush. */
  rung?: 1 | 2 | 3
  /** The bubble's text, capped. */
  why: string
  /** What to do about it. */
  fix: string
  endedAt?: number
  how?: RedHow
}

/** One session's events, under `reds:<project>:<session id>`. */
export type RedSlot = { v: 1; sessionId: string; savedAt: number; events: RedEvent[] }

/** Events a slot keeps: the newest. */
export const REDS_PER_SLOT = 200
/** A slot untouched this long is dropped at the next start. */
export const REDS_KEEP_MS = 7 * 24 * 60 * 60_000
/** Slots kept: the newest, however many sessions ran in the week. */
export const REDS_SLOTS = 60
/** Events `/reds` lists. */
export const REDS_SHOWN = 20
const WHY_MAX = 140
const FIX_MAX = 200

/** The fix, per channel (Bradley's words, 2026-10-11). A blush's fix is its own undo text. */
export const FIX: Readonly<Record<'hold' | 'refusal' | 'haemorrhage' | 'lamp', string>> = {
  hold: 'answer the hold, or name what it touches: WITH w AS (<statement> RETURNING *) SELECT * FROM w',
  refusal: "nothing was written: read the guard's reason, change the statement, and read the target back before any retry",
  haemorrhage: 'the write happened: check what it touched',
  lamp: 'none: the lamp test proves the red channel works',
}

const CHANNELS: readonly RedChannel[] = ['lamp', 'blush', 'hold', 'refusal', 'haemorrhage']
const LEVELS: readonly RedLevel[] = ['amber', 'red']
const HOWS: readonly RedHow[] = ['lapsed', 'cleared', 'answered', 'failed', 'burst']

export const redsPrefix = (project: string): string => `reds:${project}:`
export const redsSlotKey = (project: string, sessionId: string): string => `${redsPrefix(project)}${sessionId}`

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, n: number): string => {
  const t = squash(s)
  return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t
}

export type OpenRed = { channel: RedChannel; level: RedLevel; rung?: 1 | 2 | 3; why: string; fix: string; at: number }

/** The events with a new open one appended; the oldest fall off past the cap. */
export function openRed(events: readonly RedEvent[], o: OpenRed): RedEvent[] {
  const event: RedEvent = {
    id: `${o.channel}${o.at}-${events.length}`,
    at: o.at,
    channel: o.channel,
    level: o.level,
    ...(o.rung === undefined ? {} : { rung: o.rung }),
    why: cut(o.why, WHY_MAX),
    fix: cut(o.fix, FIX_MAX),
  }
  return [...events.map((e) => ({ ...e })), event].slice(-REDS_PER_SLOT)
}

/** Every still-open event matching `which` (an id, or a whole channel) ended `how` at `at`. */
export function closeRed(events: readonly RedEvent[], which: { id: string } | { channel: RedChannel }, how: RedHow, at: number): RedEvent[] {
  return events.map((e) => {
    const hit = 'id' in which ? e.id === which.id : e.channel === which.channel
    return hit && e.endedAt === undefined ? { ...e, endedAt: at, how } : { ...e }
  })
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function asEvent(v: unknown): RedEvent | null {
  if (v === null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !isNum(o.at) || typeof o.why !== 'string' || typeof o.fix !== 'string') return null
  if (!CHANNELS.includes(o.channel as RedChannel) || !LEVELS.includes(o.level as RedLevel)) return null
  const rung = o.rung === 1 || o.rung === 2 || o.rung === 3 ? o.rung : undefined
  const ended = isNum(o.endedAt) && HOWS.includes(o.how as RedHow)
  return {
    id: o.id.slice(0, 40),
    at: o.at,
    channel: o.channel as RedChannel,
    level: o.level as RedLevel,
    ...(rung === undefined ? {} : { rung }),
    why: cut(o.why, WHY_MAX),
    fix: cut(o.fix, FIX_MAX),
    ...(ended ? { endedAt: o.endedAt as number, how: o.how as RedHow } : {}),
  }
}

/** What this session writes to its own slot: the named fields only, the newest events. */
export function redSlot(o: { sessionId: string; savedAt: number; events: readonly RedEvent[] }): RedSlot {
  const events = o.events.map(asEvent).filter((e): e is RedEvent => e !== null).slice(-REDS_PER_SLOT)
  return { v: 1, sessionId: o.sessionId, savedAt: o.savedAt, events }
}

/** A stored slot read back; null for anything else. Events that are not well formed are dropped. */
export function asRedSlot(v: unknown): RedSlot | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.v !== 1 || typeof o.sessionId !== 'string' || o.sessionId === '' || !isNum(o.savedAt)) return null
  return redSlot({ sessionId: o.sessionId, savedAt: o.savedAt, events: Array.isArray(o.events) ? (o.events as RedEvent[]) : [] })
}

/** A slot is dropped when it is another session's and untouched for a week. */
export const redsStale = (slot: RedSlot, now: number, self: string): boolean => slot.sessionId !== self && now - slot.savedAt > REDS_KEEP_MS

/** `4 events: blush 3 (2 amber, 1 red), refusal 1 (1 red)`. */
export function redsSummary(events: readonly RedEvent[]): string {
  if (events.length === 0) return '0 events'
  const parts = CHANNELS.flatMap((c) => {
    const of = events.filter((e) => e.channel === c)
    if (of.length === 0) return []
    const levels = LEVELS.map((l) => [l, of.filter((e) => e.level === l).length] as const)
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${n} ${l}`)
    return [`${c} ${of.length} (${levels.join(', ')})`]
  })
  return `${events.length} event${events.length === 1 ? '' : 's'}: ${parts.join(', ')}`
}

const stamp = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ') + 'Z'
const clock = (at: number): string => new Date(at).toISOString().slice(11, 16) + 'Z'
const outcome = (e: RedEvent): string => (e.how === undefined ? 'still showing' : e.how)

/**
 * The print's Safelight section: counts by channel and level, then each RED event on a line of
 * its own. The lamp test is a bulb check, not an event to act on, so it is left out here (it is in
 * /reds). Empty when there were no red events.
 */
export function redsSection(events: readonly RedEvent[]): string[] {
  const real = events.filter((e) => e.channel !== 'lamp')
  const reds = real.filter((e) => e.level === 'red')
  if (reds.length === 0) return []
  return [
    '## Safelight',
    '',
    `Safelight this session: ${redsSummary(real)}.`,
    '',
    ...reds.map((e) => `- ${clock(e.at)} ${e.channel}: ${e.why} | fix: ${e.fix} | ${outcome(e)}`),
  ]
}

/** `/reds`: a count line, then the newest events across sessions, each with its session tag. */
export function redsList(slots: readonly RedSlot[]): string[] {
  const all = slots.flatMap((s) => s.events.map((e) => ({ e, tag: sessionTag(s.sessionId) })))
  if (all.length === 0) return ['No safelight events recorded for this project.']
  // Events logged in one millisecond keep their recorded order: the later one is the newer.
  const shown = all.map((x, i) => ({ ...x, i })).sort((a, b) => b.e.at - a.e.at || b.i - a.i).slice(0, REDS_SHOWN)
  const head = `${redsSummary(all.map((x) => x.e))} - last ${Math.min(REDS_SHOWN, all.length)} shown, newest first`
  return [head, ...shown.map(({ e, tag }) => `[s${tag}] ${stamp(e.at)} ${e.channel} ${e.level}${e.rung === undefined ? '' : ` r${e.rung}`}: ${e.why} | fix: ${e.fix} | ${outcome(e)}`)]
}
