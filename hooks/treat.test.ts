import { test, expect } from 'claude-code/testing'
import type { Barnacle, Candidate, Friction, RepairPair } from '../types'
import {
  MAX_TREAT_RECORDS,
  TREAT_HEADER,
  isTreatPrompt,
  markTreating,
  parseTreated,
  relatedCandidates,
  relatedPairs,
  treatPrompt,
  treatVerdict,
  treatedText,
} from './treat'

// Treat and wash (Bradley, 2026-10-09, relayed from a sibling session): treat hands the session the
// barnacle's evidence to propose a fix; the barnacle comes off only when the fix has landed.

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const barnacle = (over: Partial<Barnacle> = {}): Barnacle => ({ key: SQL, text: 'execute_sql keeps naming a column that is not there.', spoken: true, ...over })
const fr = (at: number, detail = 'column "statuss" does not exist', key = SQL): Friction => ({ kind: 'tool-failure', key, at, detail })
const pair = (over: Partial<RepairPair> = {}): RepairPair => ({
  key: '42703|workspace.todo_mirror.statuss',
  antigen: { tool: SQL, code: '42703', kind: 'undefined-column', target: 'workspace.todo_mirror.statuss', fragment: 'statuss', reason: 'r' },
  failures: 2,
  failedTool: SQL,
  failed: 'bad',
  cureTool: SQL,
  cured: 'good',
  diff: { where: 'content', removed: ['statuss'], added: ['status'] },
  cost: 120,
  firstAt: 1,
  at: 2,
  autoimmune: false,
  ...over,
})
const cand = (key: string, title: string): Candidate => ({ key, kind: 'hook', title, why: 'w', evidence: 'e', at: 1, filed: false })

test('the treat prompt carries the barnacle, its friction, its pairs and what was proposed, then the ask', () => {
  const text = treatPrompt({
    barnacle: barnacle(),
    friction: [fr(Date.UTC(2026, 9, 8)), fr(Date.UTC(2026, 9, 9), 'other tool', 'Bash')],
    pairs: [pair()],
    candidates: [cand('pair:42703|workspace.todo_mirror.statuss', 'Check workspace.todo_mirror.statuss before sending')],
  })
  expect(text.startsWith(TREAT_HEADER)).toBe(true)
  expect(text).toContain('execute_sql keeps naming a column')
  expect(text).toContain('column "statuss" does not exist')
  expect(text).not.toContain('other tool')
  expect(text).toContain('42703 undefined-column on workspace.todo_mirror.statuss')
  expect(text).toContain('[hook] Check workspace.todo_mirror.statuss before sending')
  expect(text).toContain('Propose ONE fix')
  expect(text).toContain(`call the treated tool with key "${SQL}"`)
  expect(isTreatPrompt(`  ${text}`)).toBe(true)
  expect(isTreatPrompt('please treat the barnacle')).toBe(false)
})

test('the treat prompt keeps the newest records and says none where there is nothing', () => {
  const many = Array.from({ length: MAX_TREAT_RECORDS + 5 }, (_, i) => fr(i * 1000, `d${i}`))
  const text = treatPrompt({ barnacle: barnacle(), friction: many, pairs: [], candidates: [] })
  expect(text).not.toContain('d0\n')
  expect(text).toContain(`d${MAX_TREAT_RECORDS + 4}`)
  expect(text.match(/- \(none\)/g)?.length).toBe(2)
})

test('related pairs and candidates: by tool, epitope or target; a pair candidate or one naming the key', () => {
  const p = pair()
  const other = pair({ key: 'k', antigen: { ...p.antigen, tool: 'Edit', target: 'a.ts' } })
  expect(relatedPairs(SQL, [p, other])).toEqual([p])
  expect(relatedPairs('a.ts', [p, other])).toEqual([other])
  const c1 = cand(`pair:${p.key}`, 'x')
  const c2 = cand('hook:y', `guard ${SQL}`)
  const c3 = cand('hook:z', 'nothing')
  expect(relatedCandidates(SQL, [c1, c2, c3], [p])).toEqual([c1, c2])
})

test('parseTreated wants a key and a one-line fix', () => {
  expect(parseTreated({ key: ' k ', fix: 'a hook\nthat checks' })).toEqual({ key: 'k', fix: 'a hook that checks' })
  expect(parseTreated({ key: 'k' })).toBeNull()
  expect(parseTreated({ key: '', fix: 'x' })).toBeNull()
  expect(parseTreated(null)).toBeNull()
  expect(parseTreated({ key: 'k', fix: 'x'.repeat(500) })!.fix).toHaveLength(200)
})

test('a treated call is believed only for a barnacle in treatment, once something was written since', () => {
  expect(treatVerdict(undefined, 3)).toEqual({ ok: false, reason: 'No barnacle with that key is on the shell.' })
  const v = treatVerdict(barnacle(), 3)
  expect(v.ok).toBe(false)
  expect(v.ok ? '' : v.reason).toContain('only the person starts one')
  const t = treatVerdict(barnacle({ treating: 5 }), 0)
  expect(t.ok ? '' : t.reason).toContain('no fix has landed')
  expect(treatVerdict(barnacle({ treating: 5 }), 1)).toEqual({ ok: true })
})

test('markTreating marks one and mutates nothing; the regrowth text names the fix', () => {
  const list = Object.freeze([Object.freeze(barnacle()), Object.freeze(barnacle({ key: 'b' }))]) as readonly Barnacle[]
  const next = markTreating(list, SQL, 9)
  expect(next[0]!.treating).toBe(9)
  expect(next[1]!.treating).toBeUndefined()
  expect(list[0]!.treating).toBeUndefined()
  expect(treatedText(barnacle(), 'a hook on 42703')).toBe('execute_sql keeps naming a column that is not there. The fix did not hold: a hook on 42703')
})
