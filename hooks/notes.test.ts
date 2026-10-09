import { test, expect } from 'claude-code/testing'

import type { Candidate, Friction, Observed, Spoken } from '../types'
import {
  CANDIDATE_MIN_NEW_CALLS,
  CANDIDATE_SCAN_MS,
  HEADS_UP,
  INSTALLED_GUARDS,
  MAX_CANDIDATES,
  SPOKEN_CAP,
  appendCandidates,
  callDigest,
  candidatesPath,
  candidatesPrompt,
  candidatesSection,
  coveringGuard,
  markFiled,
  mergeCandidates,
  notesSection,
  noteHeard,
  noteSpoken,
  parseCandidates,
  shouldScan,
} from './notes'

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
    { kind: 'hook', title: 'Confirm before execute_sql runs a write', why: 'two writes went out unchecked', evidence: 'e' },
    { kind: 'hook', title: 'Block heredoc file writes', why: 'w', evidence: 'e' },
    { kind: 'hook', title: 'Warn when a Notion page fetch returns 404', why: 'w', evidence: 'e' },
    { kind: 'skill', title: 'Confirm before execute_sql runs a write', why: 'w', evidence: 'e' },
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
  const reply = '```json\n{"candidates":[' +
    '{"kind":"hook","title":"Guard bare UPDATEs","why":"w","evidence":"e"},' +
    '{"kind":"skill","title":"Commit and push one path","why":"done 4 times","evidence":"git add / commit / push"},' +
    '{"kind":"script","title":"bad kind","why":"w","evidence":"e"},' +
    '{"kind":"skill","title":"","why":"w","evidence":"e"},' +
    '{"kind":"skill","title":"Commit and push one path","why":"dup","evidence":"e"}]}\n```'
  const got = parseCandidates(reply, [cand('Guard bare UPDATEs')], 99)
  expect(got.map(c => c.title)).toEqual(['Commit and push one path'])
  expect(got[0]).toMatchObject({ kind: 'skill', at: 99, filed: false })
  expect(parseCandidates('no json here', [], 1)).toEqual([])
  const many = JSON.stringify({ candidates: Array.from({ length: 9 }, (_, i) => ({ kind: 'hook', title: `t${i}`, why: 'w', evidence: 'e' })) })
  expect(parseCandidates(many, [], 1).length).toBe(MAX_CANDIDATES)
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
