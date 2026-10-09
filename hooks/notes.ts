// Two sections of the Witness print, ruled by Bradley in S163 (2026-10-07):
//
// - "Notes taken": what the witness itself SAW this watch - writes it held and how they
//   were answered, friction (cancelled writes, repeated failures, re-edits), and what it
//   said in its bubble. Built only from ledgers it already keeps; nothing is extracted.
// - "Hook and skill candidates": a side pass reads recurring friction and the session's
//   call digest and proposes "this could be a hook" (an event-bound guard or check) or
//   "this could be a skill" (a repeated multi-step procedure), each with its evidence.
//   Listed in the print and appended to one running file. Proposals only: the witness
//   never builds a hook or a skill. Pure.

import type { Candidate, Friction, Observed, Spoken } from '../types'
import { cleanText, normalise, parseJsonObject } from './asks'

export const SPOKEN_CAP = 60
export const NOTES_CAP = 25
export const MAX_CANDIDATES = 5
export const CANDIDATES_KEPT = 40
/** The candidate pass runs at most this often, and only after this many new calls. */
export const CANDIDATE_SCAN_MS = 30 * 60_000
export const CANDIDATE_MIN_NEW_CALLS = 25
export const DIGEST_CALLS = 150
const DIGEST_CHARS = 100
const TITLE_CHARS = 80
const WHY_CHARS = 160
const EVIDENCE_CHARS = 200

/** Headers that are not notes: the print announcing itself. */
const NOT_A_NOTE = new Set(['PRINT'])

const one = (text: string, max: number): string => {
  const t = cleanText(text)
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`
}

/** Records one thing the companion said; an immediate repeat collapses, the newest are kept. */
export function noteSpoken(log: readonly Spoken[], said: Spoken): Spoken[] {
  const last = log[log.length - 1]
  if (last !== undefined && last.header === said.header && last.text === said.text) return [...log]
  return [...log, { ...said }].slice(-SPOKEN_CAP)
}

/** The header a note from beneath is recorded under. */
export const HEADS_UP = 'HEADS UP'

/** Records a note heard from beneath once per watch: one already in the log, anywhere, is not added again. */
export function noteHeard(log: readonly Spoken[], said: Spoken): Spoken[] {
  const seen = log.some(x => x.header === said.header && x.text === said.text)
  return seen ? [...log] : [...log, { ...said }].slice(-SPOKEN_CAP)
}

function frictionLine(f: Friction): string {
  const key = one(f.key, 120)
  const detail = one(f.detail, 160)
  switch (f.kind) {
    case 'cancelled-write':
      return `- held or cancelled write: ${key} - ${detail}`
    case 'let-through':
      return `- let through once: ${key} - ${detail}`
    case 'returning-added':
      return `- held, RETURNING added: ${key} - ${detail}`
    case 'tool-failure':
      return `- repeated failure: ${key} - ${detail}`
    case 're-edit':
      return `- re-edited three times: ${key}`
  }
}

/** The "Notes taken" lines for the print: this watch only, one line per note. */
export function notesSection(o: { friction: readonly Friction[]; spoken: readonly Spoken[]; since: number }): string[] {
  const events = [
    ...o.friction.filter(f => f.at >= o.since).map(f => ({ at: f.at, line: frictionLine(f) })),
    ...o.spoken
      .filter(x => x.at >= o.since && !NOT_A_NOTE.has(x.header))
      .map(x => ({ at: x.at, line: `- said (${one(x.header, 40)}): ${one(x.text, 200)}` })),
  ].sort((a, b) => a.at - b.at)
  const lines = [...new Set(events.map(e => e.line))]
  const head = ['### Notes taken', '']
  if (lines.length === 0) return [...head, '- Nothing noted.']
  const kept = lines.slice(0, NOTES_CAP)
  const more = lines.length - kept.length
  return more > 0 ? [...head, ...kept, `- ... and ${more} more`] : [...head, ...kept]
}

/** This session's main-session calls, one short line each, newest last. */
export function callDigest(observed: readonly Observed[], max = DIGEST_CALLS): string[] {
  return observed
    .filter(o => !o.agent)
    .slice(-max)
    .map(o => one(`${o.tool}: ${o.input}`, DIGEST_CHARS))
}

/** Installed slash commands the candidate pass is shown, at most, and each description's length. */
export const MAX_INSTALLED = 80
const INSTALLED_DESC = 90

/**
 * One installed guard or mod. `covers`: term sets, any one of which, all its terms found
 * (lowercase substrings) in a hook candidate's title and why, means the guard already does it.
 */
export type Guard = {
  name: string
  where: string
  does: string
  covers: ReadonlyArray<readonly string[]>
  disabled?: boolean
}

/**
 * The installed guards and mods (to-do 3f23...b0be, second half), from the wired-hooks
 * table in ~/.claude/rules/common/hooks.md and the estate's CLAUDE.md "Supabase write
 * paths". Static: edit it when a guard or a mod is wired, unwired or retired.
 */
export const INSTALLED_GUARDS: readonly Guard[] = [
  { name: 'shell-guard.py', where: 'PreToolUse Bash|PowerShell (managed)', does: 'blocks heredoc and here-string writes to a file, .env clobbers, and git add -A / git add . / git commit -a', covers: [['heredoc'], ['here-string'], ['.env'], ['git add -a'], ['git add .'], ['commit -a']] },
  { name: 'agent-contract.py', where: 'PreToolUse, all tools (managed)', does: "binds a subagent to its contract in agent-contracts.json: paths, tools, call and wall-clock budgets", covers: [['agent contract'], ['subagent', 'path'], ['subagent', 'budget'], ['subagent', 'forbidden']] },
  { name: 'agent-contract.py', where: 'SubagentStart, SubagentStop (managed)', does: 'starts the budget clock; reports a zero-tool-call fork and a missing exit artifact', covers: [['silent fork'], ['zero tool'], ['zero-tool'], ['exit artifact']] },
  { name: 'hook-show-me-hint.py', where: 'UserPromptSubmit', does: 'hints the show-me staging viewer when a prompt asks to see a file', covers: [['show-me'], ['show me', 'file'], ['staging viewer']] },
  { name: 'hook-crosstalk-nudge.py', where: 'UserPromptSubmit', does: 'nudges toward /crosstalk when a prompt reads like a cross-agent handoff', covers: [['crosstalk', 'nudge'], ['crosstalk', 'remind'], ['crosstalk', 'prompt'], ['handoff', 'prompt']] },
  { name: 'supabase-sql-verdict.py', where: 'PreToolUse mcp__claude_ai_Supabase__.*', does: 'judges every Supabase MCP call; only one keyed UPDATE or DELETE on a known workspace table, with RETURNING, passes', covers: [['execute_sql', 'write'], ['execute_sql', 'confirm'], ['execute_sql', 'destructive'], ['execute_sql', 'update'], ['execute_sql', 'delete'], ['update', 'returning'], ['delete', 'returning'], ['bare update'], ['bare delete'], ['destructive sql'], ['destructive-sql']] },
  { name: 'supabase-elicitation-accept.py', where: 'Elicitation', does: "auto-accepts the Supabase destructive-SQL dialog only when the session's recent Supabase verdicts all passed", covers: [['elicitation'], ['destructive', 'dialog'], ['auto-accept'], ['auto accept']] },
  { name: 'trap-annotator', where: 'mod, tool.call', does: 'notes a tool result that reads like proof but is not (Notion update no-ops, the reconcile request id, multi-statement execute_sql, first-write stamps)', covers: [['no-op'], ['silent success'], ['request id'], ['multi-statement']] },
  { name: 'subagent-model-guard', where: 'mod, agent.spawn', does: 'gives a spawn with no model Sonnet; toasts an Opus or Fable spawn or fork', covers: [['subagent', 'model'], ['agent', 'sonnet'], ['opus'], ['fable']] },
  { name: 'witness', where: 'mod', does: 'holds a bare Supabase UPDATE or DELETE with no RETURNING; keeps "done" claims pale until a read-back; tracks asks and the confirm tool', covers: [['read-back'], ['read back'], ['claim', 'verif'], ['done', 'verif'], ['returning']] },
  { name: 'estate-status', where: 'mod, disabled (folded into witness 0.3.0)', does: 'drew the estate ticket line; witness draws it now', covers: [['estate ticket'], ['ticket line']], disabled: true },
]

/** The guard or mod a hook candidate restates, or null; skills are never filtered here. */
export function coveringGuard(
  c: { kind: string; title: string; why: string },
  guards: readonly Guard[] = INSTALLED_GUARDS,
): Guard | null {
  if (c.kind !== 'hook') return null
  const text = `${c.title} ${c.why}`.toLowerCase()
  return guards.find(g => g.covers.some(terms => terms.every(t => text.includes(t)))) ?? null
}

const guardLine = (g: Guard): string => `- ${g.name} [${g.where}]: ${g.does}`

/** The side pass's prompt: candidates only on evidence, strict JSON back. */
export function candidatesPrompt(o: {
  friction: readonly Friction[]
  calls: readonly string[]
  existing: readonly Candidate[]
  /** Installed commands and skills (a field report): never proposed again as skills. */
  installed?: ReadonlyArray<{ name: string; description: string }>
  /** The guards to name (1.0): the estate's list where the estate is present, else none. */
  guards?: readonly Guard[]
}): string {
  const guards = (o.guards ?? INSTALLED_GUARDS).map(guardLine)
  const friction = o.friction.slice(-60).map(f => `- ${f.kind} ${one(f.key, 80)}: ${one(f.detail, 100)}`)
  const existing = o.existing.map(c => `- [${c.kind}] ${c.title}`)
  const installed = (o.installed ?? []).slice(0, MAX_INSTALLED).map(c => `- /${c.name}: ${one(c.description, INSTALLED_DESC)}`)
  return [
    'You read what one Claude Code session did: its recorded friction and a digest of its tool calls.',
    'Propose things that could be automated, ONLY where the log itself is the evidence:',
    '- HOOK: something that should happen, or be prevented, every time an event occurs (a guard, a check, a reminder). Evidence: friction that recurs, or a mistake corrected more than once.',
    '- SKILL: a multi-step manual sequence (three or more steps) done two or more times, that a named procedure could run. Evidence: the repeated calls.',
    'Never propose a skill that an installed command already covers, even if the session did the steps by hand.',
    'Never propose a hook or guard that an installed guard or mod already covers, even if the friction shows it firing: that is the guard working.',
    'Quote the log in "evidence". Skip anything already proposed. If nothing qualifies, return {"candidates": []}.',
    `At most ${MAX_CANDIDATES}. Reply with strict JSON only:`,
    '{"candidates": [{"kind": "hook" | "skill", "title": "<= 80 chars", "why": "<= 160 chars", "evidence": "<= 200 chars"}]}',
    '',
    'Already proposed:',
    ...(existing.length > 0 ? existing : ['- (none)']),
    '',
    'Installed commands:',
    ...(installed.length > 0 ? installed : ['- (none listed)']),
    '',
    'Installed guards and mods:',
    ...(guards.length > 0 ? guards : ['- (none listed)']),
    '',
    'Friction:',
    ...(friction.length > 0 ? friction : ['- (none)']),
    '',
    'Tool calls, oldest first:',
    ...(o.calls.length > 0 ? o.calls.map(c => `- ${c}`) : ['- (none)']),
  ].join('\n')
}

const candidateKey = (kind: string, title: string): string => `${kind}:${normalise(title)}`

/** The side pass's reply as candidates: tolerant of junk, validated, deduped, capped. */
export function parseCandidates(
  reply: string,
  existing: readonly Candidate[],
  at: number,
  guards: readonly Guard[] = INSTALLED_GUARDS,
): Candidate[] {
  const raw = parseJsonObject(reply)?.candidates
  if (!Array.isArray(raw)) return []
  const seen = new Set(existing.map(c => c.key))
  const out: Candidate[] = []
  for (const item of raw) {
    const x = item as { kind?: unknown; title?: unknown; why?: unknown; evidence?: unknown }
    if (x?.kind !== 'hook' && x?.kind !== 'skill') continue
    const title = one(typeof x.title === 'string' ? x.title : '', TITLE_CHARS)
    if (title === '') continue
    const key = candidateKey(x.kind, title)
    if (seen.has(key)) continue
    seen.add(key)
    const why = one(typeof x.why === 'string' ? x.why : '', WHY_CHARS)
    if (coveringGuard({ kind: x.kind, title, why }, guards) !== null) continue
    const evidence = one(typeof x.evidence === 'string' ? x.evidence : '', EVIDENCE_CHARS)
    out.push({ key, kind: x.kind, title, why, evidence, at, filed: false })
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

export function mergeCandidates(existing: readonly Candidate[], fresh: readonly Candidate[]): Candidate[] {
  return [...existing, ...fresh].slice(-CANDIDATES_KEPT)
}

export function markFiled(candidates: readonly Candidate[], keys: readonly string[]): Candidate[] {
  const filed = new Set(keys)
  return candidates.map(c => (filed.has(c.key) ? { ...c, filed: true } : { ...c }))
}

/** Is a candidate pass due? Both the interval and enough new calls since the last one. */
export function shouldScan(o: { now: number; lastScanAt: number; newCalls: number }): boolean {
  return o.now - o.lastScanAt >= CANDIDATE_SCAN_MS && o.newCalls >= CANDIDATE_MIN_NEW_CALLS
}

const candidateLine = (c: Candidate): string =>
  `- [${c.kind}] ${c.title}${c.why ? ` - ${c.why}` : ''}${c.evidence ? ` (evidence: ${c.evidence})` : ''}`

/** The print's candidates section: this watch's proposals. */
export function candidatesSection(candidates: readonly Candidate[], since: number): string[] {
  const now = candidates.filter(c => c.at >= since)
  const head = ['### Hook and skill candidates', '']
  return now.length === 0 ? [...head, '- None proposed.'] : [...head, ...now.map(candidateLine)]
}

const FILE_HEAD = [
  '# Witness candidates',
  '',
  'Hook and skill candidates the witness companion proposed from friction and repeated',
  'sequences it saw. Proposals only: nothing here was built. Strike a line once it is ruled.',
  '',
].join('\n')

/** The running file with this watch's unfiled candidates appended; unchanged when there are none. */
export function appendCandidates(fileText: string, candidates: readonly Candidate[], o: { date: string; source: string }): string {
  const fresh = candidates.filter(c => !c.filed)
  if (fresh.length === 0) return fileText
  const base = fileText.trim() === '' ? FILE_HEAD : fileText.replace(/\s*$/, '\n')
  return `${base}\n## ${o.date} - ${one(o.source, 80)}\n\n${fresh.map(candidateLine).join('\n')}\n`
}

/** Where the running file lives: reports/ when the project has one, else beside the session logs. */
export function candidatesPath(cwd: string, hasReports: boolean): string {
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return hasReports ? `${root}/reports/witness-candidates.md` : `${root}/.claude/witness-candidates.md`
}
