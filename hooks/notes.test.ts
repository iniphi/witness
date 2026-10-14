import { test, expect } from 'claude-code/testing'

import type { Candidate, Friction, Observed, Spoken } from '../types'
import {
  CANDIDATE_MIN_NEW_CALLS,
  CANDIDATE_SCAN_MS,
  HEADS_UP,
  INSTALLED_GUARDS,
  MAX_CANDIDATES,
  MAX_HEADINGS,
  MAX_SCRIPTS,
  SPOKEN_CAP,
  appendCandidates,
  callDigest,
  candidatesPath,
  candidatesPrompt,
  candidatesSection,
  coveringGuard,
  distinctSessions,
  distinctTurns,
  markFiled,
  mdHeadings,
  mergeCandidates,
  mergeCandidatesByKey,
  notesSection,
  noteHeard,
  noteSpoken,
  parseCandidates,
  scriptSummary,
  sessionTag,
  shouldScan,
  tagFriction,
} from './notes'

/** Evidence citing two sessions, and a reason nothing listed covers the job: what a kept candidate carries. */
const EV = '[s3f2a t1] first [s9c41 t2] second'
const U = 'no listed script or guard does this'

const fr = (kind: Friction['kind'], key: string, at: number, detail = 'd'): Friction => ({ kind, key, at, detail })
const sp = (header: string, text: string, at: number): Spoken => ({ header, text, at })
const ob = (tool: string, input: string, at: number, agent = false): Observed => ({
  toolUseId: `t${at}`, tool, input, result: 'ok', isError: false, agent, at,
})
const cand = (title: string, at = 10, filed = false, kind: Candidate['kind'] = 'hook'): Candidate => ({
  key: `${kind}:${title.toLowerCase()}`, kind, title, why: 'w', evidence: 'e', at, filed,
})

// ---- what the companion said

test('noteSpoken keeps what was said, collapses an immediate repeat, and caps the log', () => {
  let log: Spoken[] = []
  log = noteSpoken(log, sp('HELD', 'a bare UPDATE', 1))
  log = noteSpoken(log, sp('HELD', 'a bare UPDATE', 2))
  expect(log.length).toBe(1)
  for (let i = 0; i < SPOKEN_CAP + 3; i++) log = noteSpoken(log, sp('YOU SHOULD KNOW', `n${i}`, 10 + i))
  expect(log.length).toBe(SPOKEN_CAP)
  expect(log[log.length - 1]?.text).toBe(`n${SPOKEN_CAP + 2}`)
})

test('noteHeard records each note from beneath once, however often it is drawn', () => {
  let log: Spoken[] = [sp(HEADS_UP, 'Heads up: try /fast', 1), sp('BOARD', 'from pm: x', 2)]
  log = noteHeard(log, sp(HEADS_UP, 'Heads up: try /fast', 3))
  expect(log.length).toBe(2)
  log = noteHeard(log, sp(HEADS_UP, 'Heads up: another', 4))
  expect(log.map(x => x.text)).toEqual(['Heads up: try /fast', 'from pm: x', 'Heads up: another'])
  expect(notesSection({ friction: [], spoken: log, since: 0 })).toContain('- said (HEADS UP): Heads up: try /fast')
})

test('notesSection lists this watch only: held writes, friction and what was said, never the print itself', () => {
  const friction = [
    fr('cancelled-write', 'workspace.todo_mirror', 50, 'UPDATE held and cancelled'),
    fr('let-through', 'workspace.page_registry', 150, 'released once'),
    fr('returning-added', 'workspace.todo_mirror', 155, 'rewritten to the CTE form'),
    fr('tool-failure', 'Bash', 160, 'second failure in a row'),
    fr('re-edit', 'c:/x/a.ts', 170, 'third edit'),
  ]
  const spoken = [sp('PRINT', 'Witness print written', 180), sp('YOU SHOULD KNOW', 'Cancelled writes recur on todo_mirror.', 190), sp('HELD', 'old', 20)]
  const lines = notesSection({ friction, spoken, since: 100 })
  expect(lines[0]).toBe('### Notes taken')
  const body = lines.join('\n')
  expect(body).toContain('let through once: workspace.page_registry - released once')
  expect(body).toContain('held, RETURNING added: workspace.todo_mirror - rewritten to the CTE form')
  expect(body).toContain('repeated failure: Bash - second failure in a row')
  expect(body).toContain('re-edited three times: c:/x/a.ts')
  expect(body).toContain('said (YOU SHOULD KNOW): Cancelled writes recur on todo_mirror.')
  expect(body).not.toContain('todo_mirror - UPDATE held')
  expect(body).not.toContain('Witness print written')
  expect(body).not.toContain('said (HELD): old')
})

test('notesSection says so when nothing was noted, and is one line per note (no markdown injection)', () => {
  expect(notesSection({ friction: [], spoken: [], since: 0 })).toEqual(['### Notes taken', '', '- Nothing noted.'])
  const lines = notesSection({ friction: [fr('re-edit', 'a\n## Injected', 5)], spoken: [], since: 0 })
  expect(lines.some(l => l.startsWith('## Injected'))).toBe(false)
})

// ---- hook and skill candidates

test('callDigest is one short line per main-session call, newest last, subagent calls left out', () => {
  const calls = [ob('Bash', 'git status', 1), ob('Read', 'x'.repeat(300), 2), ob('Bash', 'from an agent', 3, true)]
  const digest = callDigest(calls, 10)
  expect(digest.length).toBe(2)
  expect(digest[0]).toBe('Bash: git status')
  expect((digest[1] ?? '').length).toBeLessThanOrEqual(100)
})

test('candidatesPrompt asks for strict JSON, carries the evidence, and lists what is already proposed', () => {
  const p = candidatesPrompt({
    friction: [fr('cancelled-write', 'workspace.todo_mirror', 1, 'held')],
    calls: ['Bash: git add a', 'Bash: git commit -F m'],
    existing: [cand('Guard bare UPDATEs')],
  })
  expect(p).toContain('{"candidates"')
  expect(p).toContain('workspace.todo_mirror')
  expect(p).toContain('git commit -F m')
  expect(p).toContain('Guard bare UPDATEs')
})

// A field report (405_85labs): five of eleven candidates were /start, /close, /crosstalk,
// /ground and /direction-update, all installed.
test('candidatesPrompt lists the installed commands and proposes no skill one already covers', () => {
  const p = candidatesPrompt({
    friction: [],
    calls: ['Bash: git add a'],
    existing: [],
    installed: [
      { name: 'crosstalk', description: 'Canonical protocol for cross-agent handoffs over workspace.router_inbox' },
      { name: 'close', description: 'Full session close' },
    ],
  })
  expect(p).toContain('- /crosstalk: Canonical protocol for cross-agent handoffs')
  expect(p).toContain('- /close: Full session close')
  expect(p).toContain('already covers')
  expect(p.indexOf('Installed commands:') < p.indexOf('Tool calls, oldest first:')).toEqual(true)
})

// To-do 3f23...b0be (second half): the pass proposed hooks the estate already runs.
test('candidatesPrompt lists the installed guards and mods and proposes no hook one already covers', () => {
  const p = candidatesPrompt({ friction: [], calls: [], existing: [] })
  expect(p).toContain('Installed guards and mods:')
  for (const name of [
    'shell-guard.py', 'agent-contract.py', 'hook-show-me-hint.py', 'hook-crosstalk-nudge.py',
    'supabase-sql-verdict.py', 'supabase-elicitation-accept.py', 'trap-annotator', 'subagent-model-guard', 'witness', 'estate-status',
  ]) expect(p).toContain(`- ${name} [`)
  expect(p).toContain('disabled')
  expect(p).toContain('Never propose a hook or guard that an installed guard or mod already covers')
  expect(p.indexOf('Installed guards and mods:') < p.indexOf('Friction:')).toBe(true)
  expect(INSTALLED_GUARDS.every(g => g.does.length > 0 && g.covers.length > 0)).toBe(true)
})

test('a hook candidate an installed guard already covers is filtered; a new hook and a skill are not', () => {
  const reply = JSON.stringify({ candidates: [
    { kind: 'hook', title: 'Confirm before execute_sql runs a write', why: 'two writes went out unchecked', evidence: EV, uncovered: U },
    { kind: 'hook', title: 'Block heredoc file writes', why: 'w', evidence: EV, uncovered: U },
    { kind: 'hook', title: 'Warn when a Notion page fetch returns 404', why: 'w', evidence: EV, uncovered: U },
    { kind: 'skill', title: 'Confirm before execute_sql runs a write', why: 'w', evidence: EV, uncovered: U },
  ] })
  const got = parseCandidates(reply, [], 1)
  expect(got.map(c => `${c.kind}:${c.title}`)).toEqual([
    'hook:Warn when a Notion page fetch returns 404',
    'skill:Confirm before execute_sql runs a write',
  ])
  expect(coveringGuard({ kind: 'hook', title: 'confirm before execute_sql runs a write', why: '' })?.name).toBe('supabase-sql-verdict.py')
  expect(coveringGuard({ kind: 'hook', title: 'Warn on a Notion 404', why: '' })).toBe(null)
})

test('parseCandidates is tolerant, validates kind, dedupes against the existing, and caps', () => {
  const tail = `"evidence":"${EV}","uncovered":"${U}"`
  const reply = '```json\n{"candidates":[' +
    `{"kind":"hook","title":"Guard bare UPDATEs","why":"w",${tail}},` +
    `{"kind":"skill","title":"Commit and push one path","why":"done 4 times","evidence":"[s3f2a t1] git add / [s9c41 t4] commit / push","uncovered":"${U}"},` +
    `{"kind":"script","title":"bad kind","why":"w",${tail}},` +
    `{"kind":"skill","title":"","why":"w",${tail}},` +
    `{"kind":"skill","title":"Commit and push one path","why":"dup",${tail}}]}\n\`\`\``
  const got = parseCandidates(reply, [cand('Guard bare UPDATEs')], 99)
  expect(got.map(c => c.title)).toEqual(['Commit and push one path'])
  expect(got[0]).toMatchObject({ kind: 'skill', at: 99, filed: false })
  expect(parseCandidates('no json here', [], 1)).toEqual([])
  const many = JSON.stringify({ candidates: Array.from({ length: 9 }, (_, i) => ({ kind: 'hook', title: `t${i}`, why: 'w', evidence: EV, uncovered: U })) })
  expect(parseCandidates(many, [], 1).length).toBe(MAX_CANDIDATES)
})

// Jewel 1 of the 2026-10-11 calibration: a skill proposed for a job a script already did.
test('candidatesPrompt carries the scripts and CLAUDE.md headings, and omits both cleanly when absent', () => {
  const bare = candidatesPrompt({ friction: [], calls: [], existing: [] })
  expect(bare).not.toContain('Scripts already in the repo')
  expect(bare).not.toContain('Headings of the CLAUDE.md')
  const empty = candidatesPrompt({ friction: [], calls: [], existing: [], scripts: [], headings: [] })
  expect(empty).toBe(bare)
  const p = candidatesPrompt({
    friction: [], calls: [], existing: [],
    scripts: [{ name: 'sync-things.py', summary: 'Copies the global tools into the repo' }, { name: 'bare.sh', summary: '' }],
    headings: [{ file: 'CLAUDE.md', headings: ['Commands', 'Scope'] }, { file: '~/.claude/CLAUDE.md', headings: ['Identity'] }],
  })
  expect(p).toContain('- scripts/sync-things.py: Copies the global tools into the repo')
  expect(p).toContain('- scripts/bare.sh')
  expect(p).toContain('- CLAUDE.md: Commands | Scope')
  expect(p).toContain('- ~/.claude/CLAUDE.md: Identity')
  expect(p).toContain('"uncovered"')
  expect(p.indexOf('Scripts already in the repo') < p.indexOf('Friction:')).toBe(true)
})

test('the scripts and headings lists are capped', () => {
  const scripts = Array.from({ length: MAX_SCRIPTS + 10 }, (_, i) => ({ name: `s${i}.py`, summary: 'x' }))
  const headings = [{ file: 'CLAUDE.md', headings: Array.from({ length: MAX_HEADINGS + 10 }, (_, i) => `H${i}`) }]
  const p = candidatesPrompt({ friction: [], calls: [], existing: [], scripts, headings })
  expect(p).toContain(`s${MAX_SCRIPTS - 1}.py`)
  expect(p).not.toContain(`s${MAX_SCRIPTS}.py`)
  expect(p).toContain(`H${MAX_HEADINGS - 1}`)
  expect(p).not.toContain(`H${MAX_HEADINGS}`)
})

test('scriptSummary and mdHeadings read the first comment line and the # and ## headings', () => {
  expect(scriptSummary('#!/usr/bin/env python\n# Mirror the tools.\nimport os')).toBe('Mirror the tools.')
  expect(scriptSummary('"""Sweep the mirror."""\nimport os')).toBe('Sweep the mirror.')
  expect(scriptSummary('import os\n')).toBe('')
  expect(mdHeadings('# One\ntext\n## Two\n### Three\n```\n# not a heading\n```\n## Four ##')).toEqual(['One', 'Two', 'Four'])
})

test('a candidate with no uncovered reason is dropped', () => {
  const reply = JSON.stringify({ candidates: [
    { kind: 'skill', title: 'No reason given', why: 'w', evidence: EV },
    { kind: 'skill', title: 'Blank reason', why: 'w', evidence: EV, uncovered: '  ' },
    { kind: 'skill', title: 'Reason given', why: 'w', evidence: EV, uncovered: U },
  ] })
  expect(parseCandidates(reply, [], 1).map(c => c.title)).toEqual(['Reason given'])
})

// Jewel 2 of the 2026-10-11 calibration: one parallel message of five refusals read as five retries.
// Two sessions (Bradley, 2026-10-11): turns alone no longer suffice; a jewel needs two SESSIONS.
test('a candidate whose evidence cites one session is dropped, however many turns; two sessions are kept', () => {
  const reply = JSON.stringify({ candidates: [
    { kind: 'hook', title: 'One turn only', why: 'w', evidence: '[s3f2a t3] refused x5 [s3f2a t3] again', uncovered: U },
    { kind: 'hook', title: 'Many turns one session', why: 'w', evidence: '[s3f2a t1] a [s3f2a t4] b [s3f2a t9] c', uncovered: U },
    { kind: 'hook', title: 'Old turn tags', why: 'w', evidence: '[t3] refused [t7] refused again', uncovered: U },
    { kind: 'hook', title: 'No tags', why: 'w', evidence: 'refused five times', uncovered: U },
    { kind: 'hook', title: 'Two sessions', why: 'w', evidence: '[s3f2a t3] refused [s9c41] refused again', uncovered: U },
  ] })
  expect(parseCandidates(reply, [], 1).map(c => c.title)).toEqual(['Two sessions'])
})

test('a legacy friction entry is one unknown session: it counts once, and with a known session makes two', () => {
  const reply = (evidence: string): string => JSON.stringify({ candidates: [{ kind: 'hook', title: 'Legacy', why: 'w', evidence, uncovered: U }] })
  expect(parseCandidates(reply('[s?] a [s?] b'), [], 1)).toEqual([])
  expect(parseCandidates(reply('[s?] a [s3f2a t2] b'), [], 1)).toHaveLength(1)
})

test('sessionTag is a short stable hex tag that never carries the session id', () => {
  const id = 'a09f0000-1111-4222-8333-444455556666'
  const tag = sessionTag(id)
  expect(tag).toMatch(/^[0-9a-f]{5}$/)
  expect(sessionTag(id)).toBe(tag)
  expect(sessionTag('other-session')).not.toBe(tag)
  expect(id.includes(tag)).toBe(false)
  expect(sessionTag(undefined)).toBe('?')
  expect(sessionTag('')).toBe('?')
})

test('callDigest, friction and the prompt carry session tags; a parallel batch shares one turn', () => {
  const t = (o: Observed, turn: string): Observed => ({ ...o, turn })
  const calls = [t(ob('Agent', 'a', 1), 'u1'), t(ob('Agent', 'b', 2), 'u1'), t(ob('Agent', 'c', 3), 'u1'), t(ob('Bash', 'd', 10), 'u2'), ob('Read', 'old', 11)]
  const me = sessionTag('self-session')
  const digest = callDigest(calls, undefined, me)
  expect(digest.slice(0, 3)).toEqual([`[s${me} t1] Agent: a`, `[s${me} t1] Agent: b`, `[s${me} t1] Agent: c`])
  expect(digest[3]).toBe(`[s${me} t2] Bash: d`)
  expect(digest[4]).toBe(`[s${me}] Read: old`)
  const other = { ...fr('tool-failure', 'Agent', 2), session: 'other-session' }
  const own = { ...fr('tool-failure', 'Bash', 12), session: 'self-session' }
  const legacy = fr('tool-failure', 'Edit', 13)
  const tagged = tagFriction([other, own, legacy], calls, 'self-session')
  expect(tagged.map(f => f.tag)).toEqual([`[s${sessionTag('other-session')}]`, `[s${me} t2]`, '[s?]'])
  const p = candidatesPrompt({ friction: tagged, calls: digest, existing: [] })
  expect(p).toContain(`- [s${sessionTag('other-session')}] tool-failure Agent`)
  expect(p).toContain(`- [s${me} t2] tool-failure Bash`)
  expect(p).toContain('- [s?] tool-failure Edit')
  expect(p).toContain(`- [s${me} t2] Bash: d`)
  expect(p).toContain('TWO DIFFERENT SESSIONS')
  expect(distinctTurns(`[s${me} t1] a [s${me} t1] b`)).toBe(1)
  expect(distinctTurns('[t1] a [t2] b')).toBe(2)
  expect(distinctSessions('[s3f2a t1] a [s3f2a t4] b')).toBe(1)
  expect(distinctSessions('[s3f2a t1] a [s9c41] b [s?] c')).toBe(3)
})

test('with no session given, friction keeps its turn-only tag', () => {
  const t = (o: Observed, turn: string): Observed => ({ ...o, turn })
  const calls = [t(ob('Agent', 'a', 1), 'u1'), t(ob('Bash', 'd', 10), 'u2')]
  expect(tagFriction([fr('tool-failure', 'Agent', 2), fr('tool-failure', 'Bash', 12)], calls).map(f => f.tag)).toEqual(['[t1]', '[t2]'])
})

test('shouldScan waits for both the interval and enough new calls', () => {
  expect(shouldScan({ now: CANDIDATE_SCAN_MS, lastScanAt: 0, newCalls: CANDIDATE_MIN_NEW_CALLS })).toBe(true)
  expect(shouldScan({ now: CANDIDATE_SCAN_MS - 1, lastScanAt: 0, newCalls: 999 })).toBe(false)
  expect(shouldScan({ now: CANDIDATE_SCAN_MS, lastScanAt: 0, newCalls: CANDIDATE_MIN_NEW_CALLS - 1 })).toBe(false)
})

test('candidatesSection shows this watch\'s candidates, or says none were proposed', () => {
  const lines = candidatesSection([cand('Old one', 5), cand('Commit helper', 50, false, 'skill')], 10)
  expect(lines[0]).toBe('### Hook and skill candidates')
  expect(lines.join('\n')).toContain('- [skill] Commit helper - w (evidence: e)')
  expect(lines.join('\n')).not.toContain('Old one')
  expect(candidatesSection([], 0)).toEqual(['### Hook and skill candidates', '', '- None proposed.'])
})

test('appendCandidates starts the file with a header once, then appends only unfiled under a dated heading', () => {
  const first = appendCandidates('', [cand('A'), cand('B', 10, true)], { date: '2026-10-07', source: '2026-10-07-1903.md' })
  expect(first.startsWith('# Witness candidates')).toBe(true)
  expect(first).toContain('## 2026-10-07 - 2026-10-07-1903.md')
  expect(first).toContain('- [hook] A')
  expect(first).not.toContain('- [hook] B')
  const second = appendCandidates(first, [cand('C')], { date: '2026-10-08', source: 'x.md' })
  expect(second.startsWith(first)).toBe(true)
  expect(second.match(/# Witness candidates/g)?.length).toBe(1)
  expect(appendCandidates(first, [cand('B', 10, true)], { date: 'd', source: 's' })).toBe(first)
})

test('markFiled, mergeCandidates and candidatesPath', () => {
  const marked = markFiled([cand('A'), cand('B')], ['hook:a'])
  expect(marked.map(c => c.filed)).toEqual([true, false])
  expect(mergeCandidates([cand('A')], [cand('B')]).map(c => c.title)).toEqual(['A', 'B'])
  expect(candidatesPath('C:/x/proj', true)).toBe('C:/x/proj/reports/witness-candidates.md')
  expect(candidatesPath('C:/x/proj/', false)).toBe('C:/x/proj/.claude/witness-candidates.md')
})

// 1.7.1 (Bradley, 2026-10-11: "when a skill or hook is taken it reappears in the jewel section so
// i have to redismiss it"): each live session wrote its start-time copy of the list whole, so a
// jewel another session had settled came back. The store is merged by key, and settling holds.
test('mergeCandidatesByKey keeps what is stored, and a settled or filed jewel never reverts', () => {
  const taken = { ...cand('A'), settled: { how: 'taken' as const, at: 50 } }
  const staleA = cand('A')
  // Another session settled A; this session still holds A unsettled and has found B.
  const merged = mergeCandidatesByKey([taken], [staleA, cand('B', 20)])
  expect(merged.map(c => c.title)).toEqual(['A', 'B'])
  expect(merged[0].settled).toEqual({ how: 'taken', at: 50 })
  // The other order: a stale store and a fresh settle in this session also stays settled.
  expect(mergeCandidatesByKey([staleA], [taken])[0].settled).toEqual({ how: 'taken', at: 50 })
  // Filed is sticky too: filing at /wrap in either session is not undone by the other.
  expect(mergeCandidatesByKey([cand('A', 10, true)], [cand('A', 10, false)])[0].filed).toBe(true)
  expect(mergeCandidatesByKey([cand('A', 10, false)], [cand('A', 10, true)])[0].filed).toBe(true)
  // Nothing stored: this session's list as it is; and the cap still keeps the newest.
  expect(mergeCandidatesByKey([], [cand('C')]).map(c => c.title)).toEqual(['C'])
  const many = Array.from({ length: 45 }, (_, i) => cand(`T${i}`, i))
  expect(mergeCandidatesByKey(many, []).length).toBe(40)
  expect(mergeCandidatesByKey(many, [])[0].title).toBe('T5')
})
