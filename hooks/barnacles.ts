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

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit']

function pathOf(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const p = o.file_path ?? o.path ?? o.notebook_path
  return typeof p === 'string' && p !== '' ? p.toLowerCase().replace(/\\/g, '/') : null
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

function repeatedFailure(c: FrictionInput, at: number): Friction[] {
  if (!c.isError) return []
  const last = [...c.recent].reverse().find((r) => r.tool === c.tool)
  if (last === undefined || !last.isError) return []
  return [{ kind: 'tool-failure', key: c.tool, at, detail: `${c.tool} failed twice in a row` }]
}

function reEdit(c: FrictionInput, at: number): Friction[] {
  if (c.isError || !EDIT_TOOLS.includes(c.tool)) return []
  const path = pathOf(c.input)
  if (path === null) return []
  const earlier = c.recent.filter(
    (r) => !r.isError && EDIT_TOOLS.includes(r.tool) && pathOf(r.input) === path,
  ).length
  if (earlier !== 2) return []
  return [{ kind: 're-edit', key: path, at, detail: `third edit of ${path}` }]
}

export function frictionFrom(c: FrictionInput): Friction[] {
  const newest = c.recent.length > 0 ? c.recent[c.recent.length - 1]?.at ?? 0 : 0
  const at = c.at ?? newest
  return [...cancelled(c, at), ...repeatedFailure(c, at), ...reEdit(c, at)]
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
    'You read a log of friction an AI coding assistant hit (cancelled writes, repeated tool failures, files edited three times).',
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

export function nextToSpeak(barnacles: Barnacle[]): Barnacle | null {
  return barnacles.find((b) => !b.spoken) ?? null
}

export function markSpoken(barnacles: Barnacle[], key: string): Barnacle[] {
  return barnacles.map((b) => (b.key === key ? { ...b, spoken: true } : { ...b }))
}
