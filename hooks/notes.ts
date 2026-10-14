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
import { GAP_CHARS, GAP_WHY, MAX_GAP_CANDIDATES, hasProcedureShape, isTestAfterEditHook } from './charter'

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

/**
 * Turn tags (1.8, Bradley 2026-10-11): a parallel batch of calls inside one turn is one event, not
 * several. Each distinct turn id gets `[t1]`, `[t2]` ... in order of first appearance among the
 * main-session calls; calls recorded without a turn get no tag.
 */
export function turnTagMap(observed: readonly Observed[]): Map<string, string> {
  const tags = new Map<string, string>()
  for (const o of observed) {
    if (o.agent || o.turn === undefined || tags.has(o.turn)) continue
    tags.set(o.turn, `[t${tags.size + 1}]`)
  }
  return tags
}

const tagged = (tag: string | undefined, text: string): string => (tag === undefined ? text : `${tag} ${text}`)

/**
 * A short, stable session tag (Bradley, 2026-10-11, "Two sessions"): five hex characters of an
 * FNV-1a hash of the session id, so the band, the print and the public export never carry a
 * session id. `?` is the one unknown session: friction stored before sessions were kept.
 */
export function sessionTag(id: string | undefined): string {
  if (id === undefined || id === '') return '?'
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 5)
}

const sessionTagged = (session: string | undefined, turn: string | undefined): string | undefined => {
  if (session === undefined) return turn
  return `[s${session}${turn === undefined ? '' : ` ${turn}`}]`
}

/** `t3` out of a `[t3]` turn tag. */
const turnPart = (tag: string | undefined): string | undefined => (tag === undefined ? undefined : tag.slice(1, -1))

/**
 * This session's main-session calls, one short line each, newest last, each tagged with its turn.
 * With `session` (this session's tag) the tag is `[s3f2a t2]`, so a quoted tag names a session.
 */
export function callDigest(observed: readonly Observed[], max = DIGEST_CALLS, session?: string): string[] {
  const tags = turnTagMap(observed)
  return observed
    .filter(o => !o.agent)
    .slice(-max)
    .map(o => {
      const turn = o.turn === undefined ? undefined : tags.get(o.turn)
      const tag = session === undefined ? turn : sessionTagged(session, turnPart(turn))
      return tagged(tag, one(`${o.tool}: ${o.input}`, DIGEST_CHARS))
    })
}

/** Friction with the session and turn it fell in, when known. */
export type TaggedFriction = Friction & { tag?: string }

/**
 * Each friction tagged. With `self` (this session's id): friction of another session carries only
 * its session, `[s9c41]` (turn ids restart in each session, so its turn means nothing here);
 * friction with no session is the one unknown session, `[s?]`; this session's own carries the turn
 * of the latest main-session call at or before it, `[s3f2a t2]`. Without `self`, turn tags only.
 */
export function tagFriction(friction: readonly Friction[], observed: readonly Observed[], self?: string): TaggedFriction[] {
  const tags = turnTagMap(observed)
  const calls = observed.filter(o => !o.agent && o.turn !== undefined).sort((a, b) => a.at - b.at)
  return friction.map(f => {
    if (self !== undefined && f.session !== self) return { ...f, tag: `[s${sessionTag(f.session)}]` }
    let turn: string | undefined
    for (const o of calls) {
      if (o.at > f.at) break
      turn = o.turn
    }
    const turnTag = turn === undefined ? undefined : tags.get(turn)
    const tag = self === undefined ? turnTag : sessionTagged(sessionTag(self), turnPart(turnTag))
    return tag === undefined ? { ...f } : { ...f, tag }
  })
}

const TAG_RE = /\[(?:s[0-9a-f?]{1,6}\s+)?t(\d+)\]/g
const SESSION_RE = /\[s([0-9a-f]{4,6}|\?)(?:\s+t\d+)?\]/g

/** How many distinct turn tags a text cites. */
export function distinctTurns(text: string): number {
  return new Set([...text.matchAll(TAG_RE)].map(m => m[1])).size
}

/** How many distinct SESSION tags a text cites (`[s3f2a t2]`, `[s9c41]`, `[s?]`): a jewel needs two. */
export function distinctSessions(text: string): number {
  return new Set([...text.matchAll(SESSION_RE)].map(m => m[1])).size
}

/** A script in the session repo's scripts/ folder, with its first docstring or comment line. */
export type ScriptNote = { name: string; summary: string }
/** The `#`/`##` headings of one CLAUDE.md the session loads. */
export type HeadingNote = { file: string; headings: readonly string[] }

export const MAX_SCRIPTS = 40
export const MAX_HEADINGS = 40
const SCRIPT_SUMMARY = 80

/** The first docstring or comment line of a script's text; '' when it has none. Pure. */
export function scriptSummary(text: string): string {
  for (const raw of text.split(/\r?\n/).slice(0, 25)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#!') || /^(["']{3}|\/\*+)$/.test(line)) continue
    const m = /^(?:#+|\/\/+|--|rem\b|\/\*+|\*|"""|''')\s*(.*?)(?:\*\/|"""|''')?$/i.exec(line)
    if (m !== null && m[1] !== undefined && m[1].trim() !== '') return one(m[1], SCRIPT_SUMMARY)
    if (m === null) return ''
  }
  return ''
}

/** The `#` and `##` headings of a markdown text, in order. Pure. */
export function mdHeadings(text: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced
    if (fenced) continue
    const m = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (m !== null && m[2] !== undefined) out.push(one(m[2], 70))
  }
  return out
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
  friction: readonly (Friction | TaggedFriction)[]
  calls: readonly string[]
  existing: readonly Candidate[]
  /** Installed commands and skills (a field report): never proposed again as skills. */
  installed?: ReadonlyArray<{ name: string; description: string }>
  /** The guards to name (1.0): the estate's list where the estate is present, else none. */
  guards?: readonly Guard[]
  /** The session repo's scripts (1.8): what already exists. Omitted from the prompt when empty. */
  scripts?: readonly ScriptNote[]
  /** The headings of the CLAUDE.md files the session loads (1.8). Omitted from the prompt when empty. */
  headings?: readonly HeadingNote[]
  /** Routine heads seen in two or more sessions (1.9), from `sharedRoutines`. Omitted from the prompt when empty. */
  routines?: readonly string[]
  /** Titles of jewels dismissed in any project (1.11). Omitted from the prompt when empty. */
  dismissed?: readonly string[]
  /** The hooks actually configured (1.11), `- event matcher: script` lines. `undefined` omits the section. */
  hooks?: readonly string[]
}): string {
  const guards = (o.guards ?? INSTALLED_GUARDS).map(guardLine)
  const dismissed = (o.dismissed ?? []).slice(0, 40)
  const friction = o.friction.slice(-60).map(f => {
    const tag = (f as TaggedFriction).tag
    return `- ${tagged(tag, `${f.kind} ${one(f.key, 80)}: ${one(f.detail, 100)}`)}`
  })
  const scripts = (o.scripts ?? []).slice(0, MAX_SCRIPTS).map(x => `- scripts/${x.name}${x.summary === '' ? '' : `: ${one(x.summary, SCRIPT_SUMMARY)}`}`)
  let room = MAX_HEADINGS
  const headings = (o.headings ?? []).flatMap(h => {
    const take = h.headings.slice(0, Math.max(room, 0))
    room -= take.length
    return take.length === 0 ? [] : [`- ${h.file}: ${take.join(' | ')}`]
  })
  const covered = [
    ...(scripts.length > 0 ? ['', 'Scripts already in the repo (scripts/):', ...scripts] : []),
    ...(headings.length > 0 ? ['', 'Headings of the CLAUDE.md files the session loads:', ...headings] : []),
  ]
  const existing = o.existing.map(c => `- [${c.kind}] ${c.title}`)
  const installed = (o.installed ?? []).slice(0, MAX_INSTALLED).map(c => `- /${c.name}: ${one(c.description, INSTALLED_DESC)}`)
  return [
    'You read what one Claude Code session did: its recorded friction and a digest of its tool calls.',
    'Propose things that could be automated, ONLY where the log itself is the evidence:',
    '- HOOK: something that should happen, or be prevented, every time an event occurs (a guard, a check, a reminder). Evidence: friction that recurs, or a mistake corrected more than once.',
    '- SKILL: a multi-step manual sequence (three or more steps) done two or more times, that a named procedure could run. Evidence: the repeated calls.',
    'Never propose a skill that an installed command already covers, even if the session did the steps by hand.',
    'Never propose a hook or guard that an installed guard or mod already covers, even if the friction shows it firing: that is the guard working.',
    'Never propose a script or skill for a job that a script listed below or a CLAUDE.md heading listed below already covers: if the friction is that the existing route was missed, that is not a candidate.',
    'Calls and friction carry a tag such as [s3f2a t3]: s3f2a names the SESSION, t3 the turn within it. Friction from other sessions carries the session alone, [s9c41]; [s?] is one session whose id was not kept. Calls in one turn (one parallel message) are ONE event, however many lines they take.',
    'A candidate needs evidence from at least TWO DIFFERENT SESSIONS: quote the tags, for example "[s3f2a t2] ... [s9c41] ...". Repeats within one session, however many turns, are recorded but never minted: one session is never a pattern, and a one-off repair is not a procedure worth automating.',
    'One candidate per ROOT CAUSE: several symptoms of one fault are one jewel, not several.',
    'A fault that the instructions (CLAUDE.md headings, scripts) record as fixed, with a dated line, after the evidence is not a candidate.',
    'Evidence counts the tool calls themselves, never text echoed back into the transcript (the content of a file, the text of a jewel).',
    'A single tool call (one Grep, one external command) is not a procedure. A SKILL needs a sequence of at least two different kinds of call, and its evidence must cite them.',
    'Prefer "a script beside the helper that already does half" over a skill when a listed script is close.',
    'A hook candidate may not claim that a hook exists, or restate one, unless it is in the list of configured hooks below.',
    'Never propose a hook that runs tests, typecheck or build after an edit: that is test-first work, the red phase is expected.',
    `One exception to the two-session rule, at most ${MAX_GAP_CANDIDATES} per pass: a candidate from ONE session survives only if it names a GAP in "gap": a gate that does not run (a typecheck or test that skipped a folder, so did not cover what failed), or a check rebuilt by hand each sitting that no listed script holds. Quote the concrete gate or check. Without a real gap, one session is not a candidate.`,
    'Quote the log in "evidence". Skip anything already proposed. If nothing qualifies, return {"candidates": []}.',
    'Each candidate must also carry "uncovered": a short reason that nothing listed below (installed commands, guards, scripts, CLAUDE.md headings) already does this job. A candidate without it is dropped.',
    `At most ${MAX_CANDIDATES}. Reply with strict JSON only:`,
    `{"candidates": [{"kind": "hook" | "skill", "title": "<= 80 chars", "why": "<= 160 chars", "evidence": "<= 200 chars, with turn tags", "uncovered": "<= 120 chars", "gap": "<= ${GAP_CHARS} chars, ONLY for a one-session candidate"}]}`,
    '',
    'Already proposed:',
    ...(existing.length > 0 ? existing : ['- (none)']),
    ...(dismissed.length > 0
      ? ['', 'Shapes dismissed before (do not propose these again in any wording):', ...dismissed.map(d => `- ${d}`)]
      : []),
    ...(o.hooks === undefined ? [] : ['', 'Hooks configured (settings files; event, matcher, script):', ...(o.hooks.length > 0 ? o.hooks : ['- (none)'])]),
    '',
    'Installed commands:',
    ...(installed.length > 0 ? installed : ['- (none listed)']),
    '',
    'Installed guards and mods:',
    ...(guards.length > 0 ? guards : ['- (none listed)']),
    ...covered,
    '',
    'Friction:',
    ...(friction.length > 0 ? friction : ['- (none)']),
    '',
    'Tool calls, oldest first:',
    ...(o.calls.length > 0 ? o.calls.map(c => `- ${c}`) : ['- (none)']),
    ...((o.routines ?? []).length > 0
      ? ['', 'Routines seen in two or more sessions (the call head, then each session with its calls and turns; a SKILL candidate may cite one by its session tags):', ...(o.routines ?? [])]
      : []),
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
  let gapUsed = 0
  for (const item of raw) {
    const x = item as { kind?: unknown; title?: unknown; why?: unknown; evidence?: unknown; uncovered?: unknown; gap?: unknown }
    if (x?.kind !== 'hook' && x?.kind !== 'skill') continue
    // The covered check (1.8): a candidate must say why nothing that exists covers it.
    if (typeof x.uncovered !== 'string' || cleanText(x.uncovered) === '') continue
    // Two sessions (Bradley, 2026-10-11): evidence from one session is recorded, never minted. This
    // subsumes 1.8's two-turn check (two sessions are two turns); turn tags stay for grouping.
    // Exception (1.11, "Gap exception"): one session survives only when it names a gap, and at most
    // one such candidate a pass.
    const sessions = distinctSessions(typeof x.evidence === 'string' ? x.evidence : '')
    const gap = typeof x.gap === 'string' ? one(x.gap, GAP_CHARS) : ''
    const viaGap = sessions < 2
    if (viaGap && (sessions < 1 || gap === '' || gapUsed >= MAX_GAP_CANDIDATES)) continue
    const title = one(typeof x.title === 'string' ? x.title : '', TITLE_CHARS)
    if (title === '') continue
    // The charter's shape rules (1.11): no test-after-edit hook; a skill is a procedure of 2+ call heads.
    if (x.kind === 'hook' && isTestAfterEditHook(title)) continue
    if (x.kind === 'skill' && !hasProcedureShape(typeof x.evidence === 'string' ? x.evidence : '')) continue
    const key = candidateKey(x.kind, title)
    if (seen.has(key)) continue
    seen.add(key)
    const why = one(viaGap ? `${GAP_WHY}: ${gap}. ${typeof x.why === 'string' ? x.why : ''}` : typeof x.why === 'string' ? x.why : '', WHY_CHARS)
    if (coveringGuard({ kind: x.kind, title, why }, guards) !== null) continue
    const evidence = one(typeof x.evidence === 'string' ? x.evidence : '', EVIDENCE_CHARS)
    if (viaGap) gapUsed += 1
    out.push({ key, kind: x.kind, title, why, evidence, at, filed: false })
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

export function mergeCandidates(existing: readonly Candidate[], fresh: readonly Candidate[]): Candidate[] {
  return [...existing, ...fresh].slice(-CANDIDATES_KEPT)
}

/**
 * The project's stored candidates and this session's, merged by key (1.7.1, Bradley 2026-10-11:
 * "when a skill or hook is taken it reappears in the jewel section"). Every live session holds the
 * list it loaded at its start, and writing that copy whole put back a jewel another session had
 * settled: the one-slot problem friction and carry already had. So what is stored is kept, a
 * settled jewel never goes back to unsettled, and a filed one never back to unfiled. Stored order
 * first, this session's new keys after, then the cap keeps the newest.
 */
export function mergeCandidatesByKey(stored: readonly Candidate[], mine: readonly Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>()
  for (const c of [...stored, ...mine]) {
    const had = byKey.get(c.key)
    if (had === undefined) {
      byKey.set(c.key, { ...c })
      continue
    }
    const settled = had.settled ?? c.settled
    const merged: Candidate = { ...had, ...c, filed: had.filed || c.filed }
    byKey.set(c.key, settled === undefined ? withoutSettled(merged) : { ...merged, settled })
  }
  return [...byKey.values()].slice(-CANDIDATES_KEPT)
}

function withoutSettled(c: Candidate): Candidate {
  const { settled: _settled, ...rest } = c
  return rest
}

/**
 * A stray subfolder slot folded into the project's own (1.11.1, "Repo root, retire stray"): its
 * candidates are merged by key, each unsettled one marked `retired` (and filed, so the running
 * candidates file never takes it). A settled one keeps its settle, and the project's own settled
 * jewel is never overwritten (`mergeCandidatesByKey`). Pure and idempotent.
 */
export function retireStrays(own: readonly Candidate[], strays: ReadonlyArray<readonly Candidate[]>, now: number): Candidate[] {
  const room = Math.max(0, CANDIDATES_KEPT - own.length)
  const retired = strays
    .flat()
    .map(c => (c.settled === undefined ? { ...c, filed: true, settled: { how: 'retired' as const, at: now } } : { ...c }))
    .sort((a, b) => a.at - b.at)
    .slice(room === 0 ? Infinity : -room)
  return mergeCandidatesByKey(own, retired)
}

export function markFiled(candidates: readonly Candidate[], keys: readonly string[]): Candidate[] {
  const filed = new Set(keys)
  return candidates.map(c => (filed.has(c.key) ? { ...c, filed: true } : { ...c }))
}

/**
 * The candidates still waiting on the person (1.5, the gem): those with no `settled`. `filed` is
 * not settled, since filing is the automatic append at /wrap and must not take a gem off.
 */
export function unsettled(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter(c => c.settled === undefined)
}

/** The candidates with these keys settled, merged by key; the rest are copied untouched. */
export function settleCandidatesIn(candidates: readonly Candidate[], keys: readonly string[], how: 'taken' | 'dismissed', at: number): Candidate[] {
  const set = new Set(keys)
  return candidates.map(c => (set.has(c.key) && c.settled === undefined ? { ...c, settled: { how, at } } : { ...c }))
}

/** What `take` puts in the prompt box: the candidate, and a request to build it or say why not. */
export function takePrompt(c: Candidate): string {
  return `A witness ${c.kind} candidate: ${c.title}. Why: ${c.why}. Evidence: ${c.evidence}. Propose how to build it as a ${c.kind}, or say why it should not be built.`
}

/** Is a candidate pass due? Both the interval and enough new calls since the last one. */
export function shouldScan(o: { now: number; lastScanAt: number; newCalls: number }): boolean {
  return o.now - o.lastScanAt >= CANDIDATE_SCAN_MS && o.newCalls >= CANDIDATE_MIN_NEW_CALLS
}

const candidateLine = (c: Candidate): string =>
  `- [${c.kind}] ${c.title}${c.why ? ` - ${c.why}` : ''}${c.evidence ? ` (evidence: ${c.evidence})` : ''}`

/** The print's candidates section: this watch's proposals. */
export function candidatesSection(candidates: readonly Candidate[], since: number): string[] {
  const now = candidates.filter(c => c.at >= since && c.settled?.how !== 'retired')
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
