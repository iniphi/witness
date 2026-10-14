import { test, expect } from 'claude-code/testing'

import type { Candidate } from '../types'
import {
  FIRST_WEEK_PER_DAY,
  applyBudget,
  asFirstScanAt,
  configuredHooks,
  dismissedTitles,
  evidenceHeads,
  hasProcedureShape,
  hookScript,
  isTestAfterEditHook,
  queuedLine,
} from './charter'
import { candidatesPrompt, parseCandidates } from './notes'

// The jewel charter (Bradley, 2026-10-11): the gap exception, the first-week budget, and the
// generator rules from the calibration ledgers.

const DAY = 24 * 60 * 60_000
const jewel = (n: number, at: number, settled?: Candidate['settled']): Candidate => ({
  key: `hook:j${n}`,
  kind: 'hook',
  title: `jewel ${n}`,
  why: 'w',
  evidence: 'e',
  at,
  filed: false,
  ...(settled === undefined ? {} : { settled }),
})
const U = 'no listed script or guard does this'
const reply = (c: object[]): string => JSON.stringify({ candidates: c })

// --- B: the first-week budget

test('on day one only three new jewels show; the rest are queued, in the order minted', () => {
  const t0 = 1_000_000
  const all = [1, 2, 3, 4, 5].map(n => jewel(n, t0 + n))
  const { shown, queued } = applyBudget(all, t0, t0 + 1000)
  expect(shown.map(c => c.key)).toEqual(['hook:j1', 'hook:j2', 'hook:j3'])
  expect(queued.map(c => c.key)).toEqual(['hook:j4', 'hook:j5'])
  expect(FIRST_WEEK_PER_DAY).toBe(3)
})

test('the allowance grows by three each 24 h window, and a queued jewel shows later, never dropped', () => {
  const t0 = 1_000_000
  const all = [1, 2, 3, 4, 5, 6, 7].map(n => jewel(n, t0 + n))
  expect(applyBudget(all, t0, t0 + DAY + 5).shown).toHaveLength(6)
  const day3 = applyBudget(all, t0, t0 + 2 * DAY + 5)
  expect(day3.shown).toHaveLength(7)
  expect(day3.queued).toHaveLength(0)
})

test('settled jewels used their place; after the week, or with no install time, everything shows', () => {
  const t0 = 1_000_000
  const all = [
    jewel(1, t0 + 1, { how: 'dismissed', at: t0 + 5 }),
    jewel(2, t0 + 2),
    jewel(3, t0 + 3),
    jewel(4, t0 + 4),
  ]
  const day1 = applyBudget(all, t0, t0 + 100)
  expect(day1.shown.map(c => c.key)).toEqual(['hook:j2', 'hook:j3'])
  expect(day1.queued.map(c => c.key)).toEqual(['hook:j4'])
  expect(applyBudget(all, t0, t0 + 7 * DAY).queued).toHaveLength(0)
  expect(applyBudget(all, null, t0).shown).toHaveLength(3)
})

test('a jewel minted before the install is always shown, and the budget mutates nothing', () => {
  const t0 = 1_000_000
  const old = jewel(0, t0 - 5)
  const all = Object.freeze([old, ...[1, 2, 3, 4].map(n => jewel(n, t0 + n))]) as readonly Candidate[]
  const { shown, queued } = applyBudget(all, t0, t0 + 10)
  expect(shown.map(c => c.key)).toEqual(['hook:j0', 'hook:j1', 'hook:j2', 'hook:j3'])
  expect(queued).toHaveLength(1)
})

test('the queued line and the stored install time', () => {
  expect(queuedLine(0)).toBe('')
  expect(queuedLine(2)).toBe('2 more queued (first-week budget)')
  expect(asFirstScanAt(123)).toBe(123)
  expect(asFirstScanAt('x')).toBeNull()
  expect(asFirstScanAt(0)).toBeNull()
})

// --- A: the gap exception

test('a one-session candidate is kept only with a gap, says so in its why, and at most one a pass', () => {
  const one = '[s3f2a t1] Bash: tsc --noEmit [s3f2a t4] Edit: skipped folder'
  const base = { kind: 'hook', evidence: one, uncovered: U }
  const out = parseCandidates(
    reply([
      { ...base, title: 'No gap', why: 'w' },
      { ...base, title: 'Typecheck skips a folder', why: 'did not cover the failure', gap: 'tsc config omits the scripts folder' },
      { ...base, title: 'A second gap', why: 'w', gap: 'another gate' },
    ]),
    [],
    1,
  )
  expect(out.map(c => c.title)).toEqual(['Typecheck skips a folder'])
  expect(out[0]!.why).toContain('one session, a gap')
})

test('a gap does not rescue a candidate with no session tag, and two sessions need no gap', () => {
  const none = parseCandidates(reply([{ kind: 'hook', title: 'x', why: 'w', evidence: 'no tags', uncovered: U, gap: 'g' }]), [], 1)
  expect(none).toEqual([])
  const two = parseCandidates(
    reply([{ kind: 'hook', title: 'Two sessions', why: 'w', evidence: '[s3f2a t1] a [s9c41 t2] b', uncovered: U }]),
    [],
    1,
  )
  expect(two).toHaveLength(1)
  expect(two[0]!.why).toBe('w')
})

// --- C1: dismissed titles

test('dismissed titles across projects are deduped and capped, and shown to the pass', () => {
  const d = (title: string): Candidate => ({ ...jewel(1, 1, { how: 'dismissed', at: 2 }), title })
  const titles = dismissedTitles([[d('Run the tests'), d('run  the TESTS')], [d('x'.repeat(120)), jewel(2, 1), { ...jewel(3, 1, { how: 'taken', at: 2 }), title: 'taken one' }]])
  expect(titles).toHaveLength(2)
  expect(titles[1]!.length).toBe(80)
  expect(dismissedTitles([[d('a'), d('b'), d('c')]], 2)).toEqual(['a', 'b'])
  const p = candidatesPrompt({ friction: [], calls: [], existing: [], dismissed: titles })
  expect(p).toContain('Shapes dismissed before (do not propose these again in any wording)')
  expect(p).toContain('- Run the tests')
  expect(candidatesPrompt({ friction: [], calls: [], existing: [] })).not.toContain('Shapes dismissed before')
})

// --- C2: the real hook list, and no test hooks

test('configured hooks are event, matcher and script basename only', () => {
  const user = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'python "/opt/tools/shell-guard.py" --strict' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node ./notify.js' }, { type: 'command', command: 'afplay /sounds/done.mp3' }] }],
    },
  })
  const lines = configuredHooks([user, '{not json', JSON.stringify({ hooks: {} }), user])
  expect(lines).toEqual(['- PreToolUse Bash|PowerShell: shell-guard.py', '- Stop all: notify.js', '- Stop all: afplay'])
  expect(lines.join('')).not.toContain("/opt")
  expect(configuredHooks([user], 1)).toHaveLength(1)
  expect(hookScript('')).toBe('command')
})

test('the prompt lists the configured hooks and bars claiming one that is not listed', () => {
  const p = candidatesPrompt({ friction: [], calls: [], existing: [], hooks: ['- Stop all: notify.js'] })
  expect(p).toContain('Hooks configured')
  expect(p).toContain('- Stop all: notify.js')
  expect(p).toContain('may not claim that a hook exists')
  expect(candidatesPrompt({ friction: [], calls: [], existing: [], hooks: [] })).toContain('- (none)')
  expect(candidatesPrompt({ friction: [], calls: [], existing: [] })).not.toContain('Hooks configured')
})

test('a hook that runs tests, typecheck or build after an edit is suppressed; others are kept', () => {
  for (const t of ['Run typecheck after editing a .ts file', 'Run tests after every edit', 'Auto-run pytest on file save', 'Post-edit build check', 'Lint after each change']) {
    expect(isTestAfterEditHook(t)).toBe(true)
  }
  for (const t of ['Block commits when tests are red', 'Guard writes to the build output folder', 'Remind to run the full suite before closing', 'Warn when an edit targets a settings file']) {
    expect(isTestAfterEditHook(t)).toBe(false)
  }
  const ev = '[s3f2a t1] a [s9c41 t2] b'
  const out = parseCandidates(
    reply([
      { kind: 'hook', title: 'Run tests after every edit', why: 'w', evidence: ev, uncovered: U },
      { kind: 'hook', title: 'Block commits when tests are red', why: 'w', evidence: ev, uncovered: U },
    ]),
    [],
    1,
  )
  expect(out.map(c => c.title)).toEqual(['Block commits when tests are red'])
})

// --- C3 / C4: root cause, procedure shape

test('the prompt carries the root-cause, echo and procedure rules', () => {
  const p = candidatesPrompt({ friction: [], calls: [], existing: [] })
  expect(p).toContain('One candidate per ROOT CAUSE')
  expect(p).toContain('record as fixed')
  expect(p).toContain('never text echoed back')
  expect(p).toContain('A single tool call')
  expect(p).toContain('a script beside the helper')
})

test('a skill must cite two distinct call heads; a hook is not held to it', () => {
  expect(evidenceHeads('[s3f2a t1] Grep: foo [s9c41 t2] Grep: bar').size).toBe(1)
  expect(evidenceHeads('[s3f2a t1] Bash: git add x [s9c41 t2] Bash: git commit -m y').size).toBe(2)
  expect(hasProcedureShape('[s3f2a t1] Grep: foo [s9c41 t2] Grep: bar')).toBe(false)
  expect(hasProcedureShape('[s3f2a t1] Bash: python build.py [s9c41 t2] Edit: a.md')).toBe(true)
  // A count is not a head: one tool cited with its call counts is still one call.
  expect(hasProcedureShape('Grep [s3f2a] 4 calls; [s9c41] 2 calls')).toBe(false)
  expect(hasProcedureShape('git commit [s3f2a] 12 calls; git add [s9c41] 3 calls')).toBe(true)
  const one = '[s3f2a t1] Grep: foo [s9c41 t2] Grep: bar'
  const out = parseCandidates(
    reply([
      { kind: 'skill', title: 'Search skill', why: 'w', evidence: one, uncovered: U },
      { kind: 'hook', title: 'Search hook', why: 'w', evidence: one, uncovered: U },
    ]),
    [],
    1,
  )
  expect(out.map(c => c.kind)).toEqual(['hook'])
})
