// The red warning's second channel (1.4.0, Bradley 2026-10-11): a write refused BENEATH the
// witness. The hold shows red only for a write the witness itself holds; a write another guard
// refuses (a PreToolUse hook, a permission rule, the Supabase dialog) reaches the witness as the
// error its own `next(call)` returned. This module decides, from plain data, whether such a
// result is a refused write, which layer refused it, and what the band says. Display only: the
// witness never approves past another guard. Pure: time is an argument.

import type { Refusal } from '../types'
import { CANCEL_STATUS, GUARD_DENIED } from './barnacles'
import { bareWrites, tablesWritten, writerCalls } from './sql'

/** How long the red and the bubble stay when no prompt clears them first. */
export const REFUSAL_MS = 90_000
/** The whole creature is red this long from the burst's first refusal, then only the rim stays amber (1.10.0). */
export const REFUSAL_RED_MS = 10_000
const REASON_MAX = 140

// The shape lives with the other state shapes in the types contract; re-exported for callers.
export type { Refusal }

export type RefusalInput = {
  tool: string
  /** The SQL, for an execute_sql call; anything else is not an SQL write. */
  query?: string
  /** What came back from beneath: the error text, or a deny's reason. */
  resultText: string
  isError: boolean
  /** True when the engine answered with a deny rather than a result. */
  denied: boolean
  /** A subagent's call (the text says so). */
  agent: boolean
  /** The configured writer-function pattern, as classify takes it. */
  writers?: RegExp | null
}

/** A statement that writes: a bare UPDATE/DELETE, any table written, a writer function, or DDL. */
export function isSqlWrite(query: string, writers?: RegExp | null): boolean {
  if (bareWrites(query).length > 0 || tablesWritten(query).length > 0) return true
  if (writerCalls(query, writers).length > 0) return true
  return /^\s*(?:with\b[\s\S]*)?\b(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/i.test(query)
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s)

/** `PreToolUse:Bash hook error: [python shell-guard.py]: Refusing ...` -> its script and reason. */
function hookParts(text: string): { script: string; reason: string } | null {
  const m = /(?:PreToolUse|PermissionRequest)(?::[\w.*-]+)?\s+hook error:?\s*(?:\[([^\]]*)\])?:?\s*([\s\S]*)/i.exec(text)
  if (m === null) return null
  const cmd = squash(m[1] ?? '')
  const script = cmd === '' ? '' : (/([\w.-]+\.(?:py|js|ts|sh|ps1|exe|bat|cmd))\b/i.exec(cmd)?.[1] ?? cmd.split(/[\\/\s]/).pop() ?? '')
  return { script, reason: squash(m[2] ?? '') }
}

/** Which layer refused and why, from the text beneath; null when the text is not a refusal. */
export function refusalLayer(text: string, isError: boolean, denied: boolean): { layer: string; reason: string } | null {
  if (!isError && !denied && CANCEL_STATUS.test(text)) {
    return { layer: 'the Supabase dialog', reason: 'the write was cancelled at the prompt' }
  }
  if (!isError && !denied) return null
  const hook = hookParts(text)
  if (hook !== null) {
    return { layer: `a PreToolUse hook${hook.script === '' ? '' : ` (${hook.script})`}`, reason: hook.reason || squash(text) }
  }
  if (/permission (?:to use|rule)|auto mode|classifier|requires approval|was denied|has been denied|don't have permission/i.test(text)) {
    return { layer: 'a permission rule or the auto-mode classifier', reason: squash(text) }
  }
  if (GUARD_DENIED.test(text) || (denied && text.trim() !== '')) return { layer: 'another guard', reason: squash(text) }
  if (denied) return { layer: 'another guard', reason: 'no reason given' }
  return null
}

/**
 * The refusal to show, or null. Only a call the witness recognises as an SQL write counts: a
 * refused read or shell command is friction at most, never red. The call is the witness's own to
 * display; whether it was let through here is not asked, since only a write that got past the
 * witness's hold can have been refused beneath.
 */
export function refusalFrom(i: RefusalInput, now: number, noticeId: string): Refusal | null {
  if (!/execute_sql/.test(i.tool) || typeof i.query !== 'string' || !isSqlWrite(i.query, i.writers)) return null
  const found = refusalLayer(i.resultText, i.isError, i.denied)
  if (found === null) return null
  return {
    layer: found.layer,
    reason: cut(found.reason, REASON_MAX),
    tool: i.tool,
    at: now,
    until: now + REFUSAL_MS,
    noticeId,
  }
}

/** The whole creature is red while the burst's first refusal is under REFUSAL_RED_MS old. */
export function refusalRed(r: Refusal | null | undefined, now: number): boolean {
  return refusalLive(r, now) && now < (r?.at ?? 0) + REFUSAL_RED_MS
}

/**
 * Once per burst (1.10.0): a refusal arriving while one is still live keeps the burst's start (so
 * the whole-creature red does not flash again), extends the window and counts itself.
 */
export function foldRefusal(old: Refusal | null | undefined, next: Refusal, now: number): Refusal {
  if (old === null || old === undefined || !refusalLive(old, now)) return next
  return { ...next, at: old.at, count: (old.count ?? 1) + 1 }
}

/** The bubble's header and text for a refusal; a burst says how many: `REFUSED x3`. */
export function refusalNotice(r: Refusal, agent = false): { header: string; text: string } {
  const who = agent ? "A subagent's write" : 'This write'
  return {
    header: (r.count ?? 1) > 1 ? `REFUSED x${r.count}` : 'REFUSED',
    text: `${who} was refused by ${r.layer}: ${r.reason.replace(/[.\s]+$/, '')}. The witness did not hold it; that guard did.`,
  }
}

/** Red while the refusal is live. */
export function refusalLive(r: Refusal | null | undefined, now: number): boolean {
  return r !== null && r !== undefined && r.until > now
}
