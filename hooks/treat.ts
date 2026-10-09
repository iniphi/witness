// Treat a barnacle (1.2, ruled by Bradley 2026-10-09 in a sibling session and relayed to this
// build): "i thought scrub would fix the barnacles by reading the ledger and proposing a fix".
// Beside each barnacle the pane offers TREAT and WASH. Wash is the old scrub (off the shell, no
// fix: a false alarm). Treat hands the session a prompt, as /tackle does: the barnacle's words, the
// friction records behind its key, and any repair pair or candidate on it. The session proposes
// ONE fix; the person accepts or rejects it. The barnacle comes off only when the session calls
// the `treated` tool for a barnacle the person put in treatment AND something has been written
// since (the fix landed); the scrub record then keeps the fix, so a regrowth says it did not hold.
// On demand only: nothing runs at /close or /start, and the witness makes no model call. Pure.

import type { Barnacle, Candidate, Friction, RepairPair } from '../types'
import { pairLine } from './immunity'

export const TREAT_HEADER = 'Treat a barnacle the witness keeps on its shell:'
export const TREATED_TOOL = 'mcp__witness__treated'
export const MAX_TREAT_RECORDS = 12
const FIX_MAX = 200

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
const day = (at: number): string => (Number.isFinite(at) ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : '?')

/** Repair pairs that concern the barnacle's key: the same tool, the same epitope, or the same target. */
export function relatedPairs(key: string, pairs: readonly RepairPair[]): RepairPair[] {
  return pairs.filter(p => p.antigen.tool === key || p.key === key || p.antigen.target === key)
}

/** Candidates already proposed for it: a pair candidate on one of its pairs, or one naming the key. */
export function relatedCandidates(key: string, candidates: readonly Candidate[], pairs: readonly RepairPair[]): Candidate[] {
  const pairKeys = new Set(relatedPairs(key, pairs).map(p => `pair:${p.key}`))
  return candidates.filter(c => pairKeys.has(c.key) || `${c.title} ${c.evidence}`.includes(key))
}

const section = (title: string, lines: readonly string[]): string[] => [title, ...(lines.length > 0 ? lines : ['- (none)']), '']

/** The prompt the Treat button puts in the box: the evidence, and what to do with it. */
export function treatPrompt(o: {
  barnacle: Barnacle
  friction: readonly Friction[]
  pairs: readonly RepairPair[]
  candidates: readonly Candidate[]
}): string {
  const { key, text } = o.barnacle
  const records = o.friction
    .filter(f => f.key === key)
    .slice(-MAX_TREAT_RECORDS)
    .map(f => `- ${day(f.at)} ${f.kind}: ${oneLine(f.detail)}`)
  const pairs = relatedPairs(key, o.pairs).slice(-6).map(p => `- ${pairLine(p)}`)
  const proposed = relatedCandidates(key, o.candidates, o.pairs).map(c => `- [${c.kind}] ${c.title}${c.why ? ` - ${c.why}` : ''}`)
  return [
    TREAT_HEADER,
    `Barnacle \`${key}\`: ${oneLine(text)}`,
    '',
    ...section('What keeps going wrong, oldest first (the friction records behind it):', records),
    ...section('Repair pairs on it (a failed call and the call that cured it):', pairs),
    ...section('Already proposed for it:', proposed),
    'Propose ONE fix that would stop this recurring: a hook (a guard or check bound to an event), a skill line, a CLAUDE.md rule, or a code change. Say which records above it answers, and why it would hold. Make no change until the person accepts it.',
    `When the person has accepted it and the fix has landed, call the treated tool with key "${key}" and one line saying what the fix was. The barnacle then comes off; if the same friction comes back it grows back at once and says the fix did not hold.`,
    'If the person rejects it, leave the barnacle where it is. A false alarm is washed off in /barnacles.',
  ].join('\n')
}

/** The witness's own prompt, sent from the box: not mined for asks (its evidence is not the person's ask). */
export const isTreatPrompt = (text: string): boolean => text.trimStart().startsWith(TREAT_HEADER)

/** The treated tool's input: a key and a one-line fix, both present. */
export function parseTreated(input: unknown): { key: string; fix: string } | null {
  if (input === null || typeof input !== 'object') return null
  const { key, fix } = input as Record<string, unknown>
  if (typeof key !== 'string' || typeof fix !== 'string') return null
  const k = key.trim()
  const f = oneLine(fix).slice(0, FIX_MAX)
  return k === '' || f === '' ? null : { key: k, fix: f }
}

/** The shell with the barnacle `key` put in treatment at `at`; a new list. */
export function markTreating(barnacles: readonly Barnacle[], key: string, at: number): Barnacle[] {
  return barnacles.map(b => (b.key === key ? { ...b, treating: at } : { ...b }))
}

/**
 * Whether a `treated` call may take the barnacle off: only one the person put in treatment from
 * the pane (a human gesture starts it), and only once something has been written since (the fix
 * landed). The session cannot treat a barnacle on its own say.
 */
export function treatVerdict(barnacle: Barnacle | undefined, writesSince: number): { ok: true } | { ok: false; reason: string } {
  if (barnacle === undefined) return { ok: false, reason: 'No barnacle with that key is on the shell.' }
  if (barnacle.treating === undefined) {
    return { ok: false, reason: 'That barnacle was not put in treatment: only the person starts one, with Treat in /barnacles.' }
  }
  if (writesSince === 0) return { ok: false, reason: 'Nothing has been written since the treatment began, so no fix has landed yet.' }
  return { ok: true }
}

/** What the scrub record keeps for a treated barnacle: its words and the fix, said again if it regrows. */
export const treatedText = (b: Barnacle, fix: string): string => `${oneLine(b.text)} The fix did not hold: ${oneLine(fix)}`

export const TREATED_DESCRIPTION =
  'Witness: take a barnacle off the shell once its fix has landed. Only for a barnacle the person put in treatment from /barnacles (the Treat button), and only after the fix the person accepted was written. `key` is the barnacle key from the treat prompt; `fix` is one line saying what the fix was. If the same friction recurs, the barnacle grows back and says the fix did not hold.'

export const TREATED_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string', description: 'The barnacle key, exactly as the treat prompt gave it.' },
    fix: { type: 'string', description: 'One line: what the fix was (the hook, rule, skill line or change that landed).' },
  },
  required: ['key', 'fix'],
} as const
