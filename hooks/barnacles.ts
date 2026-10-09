// Barnacles: friction that recurs across sessions. Pure functions over plain data.
import type { Barnacle, Friction } from '../types'
import { parseJsonObject } from './asks'

export const FRICTION_CAP = 200
export const MAX_BARNACLES = 6

export type RecentCall = { tool: string; input: unknown; isError: boolean; at: number }
export type FrictionInput = {
  tool: string
  input: unknown
  resultText: string
  isError: boolean
  recent: RecentCall[]
  /** Epoch ms of this call; defaults to the newest recent call's time, else 0. */
  at?: number
}

export function noteFriction(log: Friction[], f: Friction): Friction[] {
  return [...log, f].slice(-FRICTION_CAP)
}

/**
 * Friction worth keeping (Bradley, 2026-10-09): a cancelled or refused write, a failing call,
 * an MCP misuse. Editing a file under build is the work itself, never friction, so the
 * third-edit kind is retired and its legacy entries are dropped on load.
 */
export function realFriction(log: Friction[]): Friction[] {
  return log.filter((f) => f.kind !== 're-edit')
}

/** The Supabase dialog's own answer when a write is declined, and nothing else (no row data). */
const CANCEL_STATUS = /^\s*\{\s*"status"\s*:\s*"cancelled"\s*\}\s*$/

function cancelled(c: FrictionInput, at: number): Friction[] {
  // A cancel is a refusal (an error naming it, as the witness hold's is) or the dialog's bare
  // status; a successful result whose rows say "cancelled" is data (a field report).
  const sqlCancelled =
    /execute_sql/.test(c.tool) && (c.isError ? /cancel/i.test(c.resultText) : CANCEL_STATUS.test(c.resultText))
  const denied = c.isError && /\b(denied|permission to use|blocked by|not permitted)\b/i.test(c.resultText)
  if (!sqlCancelled && !denied) return []
  const detail = sqlCancelled ? 'write cancelled at the prompt' : 'call denied'
  return [{ kind: 'cancelled-write', key: c.tool, at, detail }]
}

/** The first line of an error, cut short, for a friction's detail. */
const gist = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * A failing call. An MCP tool's error counts at once (a wrong column, a bad id, a misused
 * server: a misremembering, Bradley 2026-10-09); any other tool's counts on its second
 * failure in a row, since a shell command that fails once is often exploration.
 */
function callFailure(c: FrictionInput, at: number): Friction[] {
  if (!c.isError) return []
  if (c.tool.startsWith('mcp__')) return [{ kind: 'tool-failure', key: c.tool, at, detail: `${c.tool} failed: ${gist(c.resultText)}` }]
  const last = [...c.recent].reverse().find((r) => r.tool === c.tool)
  if (last === undefined || !last.isError) return []
  return [{ kind: 'tool-failure', key: c.tool, at, detail: `${c.tool} failed twice in a row` }]
}

export function frictionFrom(c: FrictionInput): Friction[] {
  const newest = c.recent.length > 0 ? c.recent[c.recent.length - 1]?.at ?? 0 : 0
  const at = c.at ?? newest
  // A cancelled or refused write is a refusal, never also a failing call.
  const refused = cancelled(c, at)
  return refused.length > 0 ? refused : callFailure(c, at)
}

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

export function recurPrompt(log: Friction[], barnacles: Barnacle[]): string {
  const groups = new Map<string, { kind: string; days: Set<string>; count: number; detail: string }>()
  for (const f of log) {
    const g = groups.get(f.key) ?? { kind: f.kind, days: new Set<string>(), count: 0, detail: f.detail }
    g.days.add(day(f.at))
    g.count++
    groups.set(f.key, g)
  }
  const lines = [...groups.entries()].map(
    ([key, g]) => `- key=${key} kind=${g.kind} count=${g.count} days=${[...g.days].sort().join(',')} detail=${g.detail}`,
  )
  const known = barnacles.map((b) => `- ${b.key}: ${b.text}`)
  return [
    'You read a log of friction an AI coding assistant hit (cancelled or refused writes, failing calls, MCP tool errors).',
    'Keep only friction that recurs: the same key on 2 or more distinct days. Drop the rest, and drop any known barnacle whose key no longer recurs.',
    'For each kept key write one plain sentence saying what keeps going wrong. Reuse the key exactly.',
    `At most ${MAX_BARNACLES} entries. Output shape: {"barnacles": [{"key": "...", "text": "..."}]}`,
    'Use {"barnacles": []} when nothing recurs. Reply with the JSON only.',
    '',
    'Known barnacles:',
    known.length === 0 ? '(none)' : known.join('\n'),
    '',
    'Friction by key:',
    lines.length === 0 ? '(none)' : lines.join('\n'),
  ].join('\n')
}

export function parseRecur(reply: string): Barnacle[] {
  const raw = parseJsonObject(reply)?.barnacles
  if (!Array.isArray(raw)) return []
  const out: Barnacle[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const { key, text } = item as Record<string, unknown>
    if (typeof key !== 'string' || typeof text !== 'string') continue
    if (key.trim() === '' || text.trim() === '' || out.some((b) => b.key === key.trim())) continue
    out.push({ key: key.trim(), text: text.trim(), spoken: false })
    if (out.length === MAX_BARNACLES) break
  }
  return out
}

/** Parsed barnacles keep the spoken flag of a known one with the same key. */
export function mergeBarnacles(existing: Barnacle[], parsed: Barnacle[]): Barnacle[] {
  return parsed.map((p) => {
    const known = existing.find((e) => e.key === p.key)
    return { ...p, spoken: known?.spoken ?? false }
  })
}

/** A scrub on record: when the key came off the shell, and what its barnacle said, so it can regrow at once. */
export type ScrubRecord = { at: number; text: string }
/** The scrubs on record, by barnacle key. */
export type Scrubbed = Readonly<Record<string, ScrubRecord>>

/** A stored scrub record; a bare number (the first cut's shape) is a scrub with no words kept. */
export function asScrubbed(v: unknown): Scrubbed {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, ScrubRecord> = {}
  for (const [k, rec] of Object.entries(v as Record<string, unknown>)) {
    if (typeof rec === 'number') out[k] = { at: rec, text: '' }
    else if (rec !== null && typeof rec === 'object' && typeof (rec as ScrubRecord).at === 'number') {
      const text = (rec as ScrubRecord).text
      out[k] = { at: (rec as ScrubRecord).at, text: typeof text === 'string' ? text : '' }
    }
  }
  return out
}

/**
 * The friction the recurrence pass may read after a scrub (/barnacles, 1.1): a scrubbed key
 * forgets everything logged at or before its scrub. (New friction on that key regrows the
 * barnacle at once through `regrown`, which also lifts the scrub.)
 */
export function afterScrub(log: Friction[], scrubbed: Scrubbed): Friction[] {
  return log.filter((f) => f.at > (scrubbed[f.key]?.at ?? Number.NEGATIVE_INFINITY))
}

/** The shell without the barnacle `key` (every barnacle when `key` is null); a new list. */
export function scrub(barnacles: Barnacle[], key: string | null): Barnacle[] {
  return key === null ? [] : barnacles.filter((b) => b.key !== key).map((b) => ({ ...b }))
}

/** The scrub record with each of `gone` stamped `at`, its words kept for the regrowth; a new object. */
export function stampScrub(scrubbed: Scrubbed, gone: readonly Barnacle[], at: number): Scrubbed {
  return gone.reduce<Record<string, ScrubRecord>>((acc, b) => ({ ...acc, [b.key]: { at, text: b.text } }), { ...scrubbed })
}

/**
 * The barnacle that regrows the moment friction `f` lands on a scrubbed key after its scrub
 * (Bradley, 2026-10-09: "if the friction occurs again it should be an instant barnacle"):
 * the old words, unspoken so it speaks again. Null when nothing regrows.
 */
export function regrown(scrubbed: Scrubbed, f: Friction): Barnacle | null {
  const rec = scrubbed[f.key]
  if (rec === undefined || f.at <= rec.at) return null
  return { key: f.key, text: rec.text !== '' ? rec.text : `${f.detail}, again after a scrub.`, spoken: false }
}

/** The scrub record without `key`: a regrown barnacle's whole history is in view again. */
export function unscrub(scrubbed: Scrubbed, key: string): Scrubbed {
  return Object.fromEntries(Object.entries(scrubbed).filter(([k]) => k !== key))
}

export function nextToSpeak(barnacles: Barnacle[]): Barnacle | null {
  return barnacles.find((b) => !b.spoken) ?? null
}

export function markSpoken(barnacles: Barnacle[], key: string): Barnacle[] {
  return barnacles.map((b) => (b.key === key ? { ...b, spoken: true } : { ...b }))
}
