// What the witness's own Haiku side passes cost (S165). Bradley's worry: four witnesses
// in four sessions, each paying for a pass on every prompt. Each call's real usage, as
// the API reported it, is kept per session in its own file (four pods never write one
// file), and scripts/witness-usage.py sums a week of them. Recording spends no tokens.

import type { UsagePass, UsageRow } from '../types'

/** Under the user's home: `~/.claude/state/witness-usage`, where scripts/witness-usage.py reads. */
export const USAGE_SUBDIR = '.claude/state/witness-usage'

/** The usage folder for a home directory; null (no usage files) when the home is unknown. */
export function usageDir(home: string | undefined): string | null {
  const h = (home ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return h === '' ? null : `${h}/${USAGE_SUBDIR}`
}
export const USAGE_ROWS_CAP = 2_000

/** The parts of $.model.complete's result (ModelCompleteResult) this reads. */
type Answer =
  | {
      isAnswered: true
      text?: string
      usage: {
        input_tokens: number
        output_tokens: number
        cache_read_input_tokens: number
        cache_creation_input_tokens: number
      }
    }
  | { isAnswered: false; reason?: string; status?: number | null }

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** One call: the counts the API reported, or zeros and not ok when it did not answer. */
export function usageRow(pass: UsagePass, at: number, r: Answer | null | undefined): UsageRow {
  if (r === null || r === undefined || !r.isAnswered) {
    return { at, pass, ok: false, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
  }
  const u = r.usage
  return {
    at,
    pass,
    ok: true,
    in: count(u?.input_tokens),
    out: count(u?.output_tokens),
    cacheRead: count(u?.cache_read_input_tokens),
    cacheWrite: count(u?.cache_creation_input_tokens),
  }
}

/**
 * One model turn (0.5.0): the turn's own usage as turn.complete reported it, summed over
 * its requests, with the model that answered. Null when the turn reported none.
 */
export function turnRow(
  pass: UsagePass,
  at: number,
  usage:
    | {
        input_tokens: number
        output_tokens: number
        cache_read_input_tokens: number
        cache_creation_input_tokens: number
        model?: string
      }
    | null
    | undefined,
): UsageRow | null {
  if (usage === null || usage === undefined) return null
  return {
    at,
    pass,
    ok: true,
    in: count(usage.input_tokens),
    out: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    model: typeof usage.model === 'string' ? usage.model : '?',
  }
}

/** Appends a row, keeping the newest USAGE_ROWS_CAP. */
export function addUsage(rows: readonly UsageRow[], row: UsageRow): UsageRow[] {
  return [...rows, row].slice(-USAGE_ROWS_CAP)
}

/** `<dir>/<YYYY-MM-DD the session started, UTC>/<session id>.json`; the id made path-safe. */
export function usagePath(dir: string, startedAt: number, sessionId: string): string {
  const day = new Date(startedAt).toISOString().slice(0, 10)
  return `${dir}/${day}/${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`
}

export function usageFile(f: {
  sessionId: string
  repo: string
  startedAt: number
  model: string
  rows: readonly UsageRow[]
}): string {
  return JSON.stringify({ version: 1, ...f }, null, 1)
}
