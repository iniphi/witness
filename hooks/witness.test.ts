import { test, expect } from 'claude-code/testing'
import type { Classified, Ledger, Write } from '../types'
import {
  MAX_CLAIMS,
  MAX_WRITES,
  bound,
  classify,
  developByAsks,
  emptyLedger,
  isDoneClaim,
  paleCount,
  recordCall,
  recordTurn,
  share,
} from './witness'

const W = (kind: Write['kind'], target: string, selfWitnessed = false): Classified => ({
  writes: [{ kind, target, selfWitnessed }],
  reads: [],
})
const R = (kind: Write['kind'], target: string): Classified => ({ writes: [], reads: [{ kind, target }] })
const NONE: Classified = { writes: [], reads: [] }

let seq = 0
const call = (l: Ledger, turnId: string, classified: Classified): Ledger =>
  recordCall(l, { turnId, at: ++seq, ids: classified.writes.map((_, i) => `w${seq}-${i}`), classified })
const turn = (l: Ledger, turnId: string, answer: string) => recordTurn(l, { turnId, at: ++seq, answer, id: `c-${turnId}` })
const witnessed = (l: Ledger) => l.writes.map((w) => w.witnessed)

// ---- recordCall

test('recordCall adds writes with the caller ids and counts the turn', () => {
  const l = recordCall(emptyLedger(), { turnId: 't1', at: 5, ids: ['a', 'b'], classified: {
    writes: [{ kind: 'file', target: 'x.ts', selfWitnessed: false }, { kind: 'sql', target: 's.t', selfWitnessed: true }],
    reads: [{ kind: 'file', target: 'y.ts' }],
  } })
  expect(l.writes).toEqual([
    { kind: 'file', target: 'x.ts', id: 'a', turnId: 't1', at: 5, witnessed: false },
    { kind: 'sql', target: 's.t', id: 'b', turnId: 't1', at: 5, witnessed: true },
  ])
  expect(l.turns).toEqual({ t1: { calls: 1, reads: 1, writes: 2 } })
  expect(call(l, 't1', NONE).turns.t1).toEqual({ calls: 2, reads: 1, writes: 2 })
})

test('recordCall never mutates the ledger it is given', () => {
  const l0 = call(emptyLedger(), 't1', W('file', 'a.ts'))
  const before = JSON.stringify(l0)
  call(l0, 't1', R('file', 'a.ts'))
  expect(JSON.stringify(l0)).toBe(before)
})

test('a read witnesses an earlier write of the same kind and target only', () => {
  let l = call(emptyLedger(), 't1', W('file', 'c:/x/a.ts'))
  l = call(l, 't1', W('sql', 'workspace.t'))
  l = call(l, 't1', R('file', 'c:/x/b.ts'))
  l = call(l, 't1', R('sql', 'c:/x/a.ts'))
  expect(witnessed(l)).toEqual([false, false])
  l = call(l, 't1', R('file', 'c:/x/a.ts'))
  expect(witnessed(l)).toEqual([true, false])
})

test('a directory read covers files beneath it, at a segment boundary', () => {
  const l = call(emptyLedger(), 't1', classify({ tool: 'Edit', input: { file_path: 'C:\\Home\\X\\a.ts' }, resultText: '', isError: false }))
  const near = call(l, 't1', classify({ tool: 'Grep', input: { pattern: 'q', path: 'C:/Home/Xy' }, resultText: '', isError: false }))
  expect(witnessed(near)).toEqual([false])
  const dir = call(l, 't1', classify({ tool: 'Grep', input: { pattern: 'q', path: 'C:/Home/X' }, resultText: '', isError: false }))
  expect(witnessed(dir)).toEqual([true])
})

test('a test run (*) witnesses every file write before it', () => {
  let l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  l = call(l, 't1', W('file', 'b/c.ts'))
  l = call(l, 't1', W('sql', 'workspace.t'))
  l = call(l, 't1', classify({ tool: 'Bash', input: { command: 'claude plugin test "C:/mod"' }, resultText: '', isError: false }))
  expect(witnessed(l)).toEqual([true, true, false])
})

test('git:* witnesses every git write; migration:* every migration write', () => {
  let l = call(emptyLedger(), 't1', W('git', 'git:commit'))
  l = call(l, 't1', W('git', 'git:push'))
  l = call(l, 't1', W('migration', 'migration:add_col'))
  l = call(l, 't1', R('git', 'git:*'))
  expect(witnessed(l)).toEqual([true, true, false])
  l = call(l, 't1', R('migration', 'migration:*'))
  expect(witnessed(l)).toEqual([true, true, true])
})

test('notion:new is witnessed by any later notion read; a named page only by its own id', () => {
  let l = call(emptyLedger(), 't1', W('notion', 'notion:new'))
  l = call(l, 't1', W('notion', 'aaaa'))
  l = call(l, 't1', R('notion', 'bbbb'))
  expect(witnessed(l)).toEqual([true, false])
})

test('a read never witnesses a write made after it', () => {
  let l = call(emptyLedger(), 't1', R('file', 'a.ts'))
  l = call(l, 't1', W('file', 'a.ts'))
  expect(witnessed(l)).toEqual([false])
  l = call(l, 't2', R('file', 'a.ts'))
  expect(witnessed(l)).toEqual([true])
})

// ---- recordTurn

test('no done claim: claim null and the ledger unchanged', () => {
  const l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  const r = turn(l, 't1', 'I looked at the file. Is it done?')
  expect(r.claim).toBeNull()
  expect(r.ledger).toBe(l)
})

test('a done claim over witnessed writes is developed; over an unwitnessed one, pale', () => {
  let l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  l = call(l, 't1', R('file', 'a.ts'))
  const good = turn(l, 't1', 'Done.')
  expect(good.claim?.state).toBe('developed')
  expect(good.claim?.writeIds).toHaveLength(1)
  const bad = turn(call(l, 't1', W('file', 'b.ts')), 't1', 'Fixed and pushed.')
  expect(bad.claim?.state).toBe('pale')
  expect(bad.claim?.writeIds).toHaveLength(2)
})

test('a claim covers writes left unwitnessed since the previous claim, in any turn', () => {
  let l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  expect(turn(l, 't1', 'I edited the file; next I will run the suite.').claim).toBeNull()
  l = call(l, 't2', classify({ tool: 'Bash', input: { command: 'git status' }, resultText: '', isError: false }))
  const r = turn(l, 't2', "Yes, it's done.")
  expect(r.claim?.state).toBe('pale')
  expect(r.claim?.writeIds).toEqual([l.writes[0]?.id])
  const back = call(r.ledger, 't3', R('file', 'a.ts'))
  expect(back.claims[0]?.state).toBe('developed')
})

test('a write already witnessed, or already under the previous claim, is not claimed again', () => {
  let l = call(emptyLedger(), 't1', W('file', 'old.ts'))
  l = turn(l, 't1', 'Done.').ledger
  l = call(l, 't2', W('file', 'seen.ts'))
  l = call(l, 't2', R('file', 'seen.ts'))
  l = call(l, 't3', W('file', 'new.ts', true))
  const r = turn(l, 't3', 'Done.')
  expect(r.claim?.state).toBe('developed')
  expect(r.claim?.writeIds).toHaveLength(1)
})

test('an unknown write (other:*) keeps its claim pale whatever is read after it', () => {
  const comment = classify({ tool: 'mcp__claude_ai_Notion__notion-create-comment', input: { page_id: 'x' }, resultText: 'ok', isError: false })
  let l = call(emptyLedger(), 't1', comment)
  l = call(l, 't1', classify({ tool: 'Bash', input: { command: 'claude plugin test .' }, resultText: '', isError: false }))
  l = call(l, 't1', R('file', '*'))
  expect(turn(l, 't1', 'Done.').claim?.state).toBe('pale')
})

test('a done claim from a turn with no tool calls is pale', () => {
  const r = turn(emptyLedger(), 't1', 'Done, the tests pass.')
  expect(r.claim?.state).toBe('pale')
  expect(r.claim?.writeIds).toEqual([])
  expect(r.ledger.claims).toHaveLength(1)
})

test('a read-only turn is developed; a turn whose calls touched nothing is pale', () => {
  expect(turn(call(emptyLedger(), 't1', R('file', 'a.ts')), 't1', 'Done.').claim?.state).toBe('developed')
  expect(turn(call(emptyLedger(), 't1', NONE), 't1', 'Done.').claim?.state).toBe('pale')
})

test('the claim keeps the first 160 characters and a second claim for a turn replaces the first', () => {
  const long = `Done. ${'x'.repeat(300)}`
  const r = turn(emptyLedger(), 't1', long)
  expect(r.claim?.text).toBe(long.slice(0, 160))
  expect(r.claim?.id).toBe('c-t1')
  const again = recordTurn(r.ledger, { turnId: 't1', at: 9, answer: 'Fixed.', id: 'c2' })
  expect(again.ledger.claims.map((c) => c.id)).toEqual(['c2'])
})

test('the claim text collapses every whitespace run, so it cannot carry a heading or checklist line', () => {
  const r = turn(emptyLedger(), 't1', '  Done.\n\n## Goals\r\n- [x]\tshipped   it  ')
  expect(r.claim?.text).toBe('Done. ## Goals - [x] shipped it')
})

// ---- subagent calls

test('a subagent call records its writes unwitnessed and leaves the turn stats alone', () => {
  const l = recordCall(emptyLedger(), { turnId: 't1', at: 1, ids: ['s1'], subagent: true, classified: W('file', 'a.ts', true) })
  expect(witnessed(l)).toEqual([false])
  expect(l.turns).toEqual({})
  expect(turn(l, 't1', 'Done.').claim?.state).toBe('pale')
})

test('a subagent other:* write is dropped, its known writes stay; a main-session one stays', () => {
  const mixed: Classified = {
    writes: [
      { kind: 'other', target: 'other:shell', selfWitnessed: false },
      { kind: 'file', target: 'a.ts', selfWitnessed: false },
    ],
    reads: [],
  }
  const sub = recordCall(emptyLedger(), { turnId: 't1', at: 1, ids: ['x', 'y'], subagent: true, classified: mixed })
  expect(sub.writes.map((w) => w.target)).toEqual(['a.ts'])
  expect(sub.turns).toEqual({})
  const main = recordCall(emptyLedger(), { turnId: 't1', at: 2, ids: ['x', 'y'], classified: mixed })
  expect(main.writes.map((w) => w.target)).toEqual(['other:shell', 'a.ts'])
})

test('a blind verifier subagent running unknown shell leaves the main claim able to develop', () => {
  let l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  l = recordCall(l, { turnId: 't1', at: ++seq, ids: ['v1'], subagent: true, classified: W('other', 'other:shell') })
  l = call(l, 't1', R('file', 'a.ts'))
  expect(turn(l, 't1', 'Done.').claim?.state).toBe('developed')
})

test('a subagent read witnesses nothing and does not make a turn touched', () => {
  let l = call(emptyLedger(), 't1', W('file', 'a.ts'))
  l = recordCall(l, { turnId: 't1', at: ++seq, ids: [], subagent: true, classified: R('file', 'a.ts') })
  expect(witnessed(l)).toEqual([false])
  expect(l.turns.t1).toEqual({ calls: 1, reads: 0, writes: 1 })
  const quiet = recordCall(emptyLedger(), { turnId: 't2', at: ++seq, ids: [], subagent: true, classified: R('file', 'b.ts') })
  expect(turn(quiet, 't2', 'Done.').claim?.state).toBe('pale')
})

test('a pale claim develops in a later turn when a read-back lands for its last write', () => {
  const sql = (query: string, resultText: string) =>
    classify({ tool: 'mcp__claude_ai_Supabase__execute_sql', input: { project_id: 'p', query }, resultText, isError: false })
  const wrap = (rows: string) => `<untrusted-data-z1>\n${rows}\n</untrusted-data-z1>`
  let l = call(emptyLedger(), 't1', sql("UPDATE workspace.todo_mirror SET status = 'Done' WHERE id = 'x'", wrap('[]')))
  const first = turn(l, 't1', 'Done. The to-do is closed.')
  expect(first.claim?.state).toBe('pale')
  expect(paleCount(first.ledger)).toBe(1)
  l = call(first.ledger, 't2', sql("SELECT status FROM workspace.todo_mirror WHERE id = 'x'", wrap('[{"status":"Done"}]')))
  expect(l.claims[0]?.state).toBe('developed')
  expect(paleCount(l)).toBe(0)
  expect(share(l)).toBe(1)
})

// ---- share and paleCount

test('share is null with no claims, else developed over claims', () => {
  expect(share(emptyLedger())).toBeNull()
  let l = turn(emptyLedger(), 't1', 'Done.').ledger
  l = turn(call(l, 't2', R('file', 'a.ts')), 't2', 'Done.').ledger
  expect(share(l)).toBe(0.5)
  expect(paleCount(l)).toBe(1)
})

// ---- bounding

test('writes are bounded to 500, the oldest witnessed dropped first', () => {
  const writes: Write[] = Array.from({ length: MAX_WRITES + 10 }, (_, i): Write => ({
    kind: 'file', target: `f${i}`, id: `w${i}`, turnId: 't', at: i, witnessed: i >= 5 && i < 20,
  }))
  const out = bound({ writes, claims: [], turns: {} })
  expect(out.writes).toHaveLength(MAX_WRITES)
  const ids = out.writes.map((w) => w.id)
  expect(ids.slice(0, 5)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4'])
  expect(ids).not.toContain('w5')
  expect(ids).not.toContain('w14')
  expect(ids).toContain('w15')
})

test('claims are bounded to 200, the oldest developed dropped first, then the oldest pale', () => {
  const claims = Array.from({ length: MAX_CLAIMS + 3 }, (_, i) => ({
    id: `c${i}`, turnId: `t${i}`, text: '', at: i, writeIds: [], state: (i === 7 ? 'developed' : 'pale') as 'pale' | 'developed',
  }))
  const ids = bound({ writes: [], claims, turns: {} }).claims.map((c) => c.id)
  expect(ids).toHaveLength(MAX_CLAIMS)
  expect(ids).not.toContain('c7')
  expect(ids).not.toContain('c0')
  expect(ids).not.toContain('c1')
  expect(ids).toContain('c2')
})

test('a write the bound dropped unwitnessed never develops the claim resting on it', () => {
  let l = call(emptyLedger(), 't1', W('file', 'claimed.ts'))
  l = turn(l, 't1', 'Done.').ledger
  for (let i = 0; i < MAX_WRITES + 2; i++) l = call(l, 't2', W('file', `pile${i}`))
  expect(l.writes.map((w) => w.target)).not.toContain('claimed.ts')
  expect(l.claims[0]?.state).toBe('pale')
})

test('recordCall keeps the ledger bounded as writes pour in', () => {
  let l = emptyLedger()
  for (let i = 0; i < MAX_WRITES + 20; i++) l = call(l, 't1', W('file', `f${i}`, i % 2 === 0))
  expect(l.writes).toHaveLength(MAX_WRITES)
  expect(l.writes.filter((w) => !w.witnessed)).toHaveLength((MAX_WRITES + 20) / 2)
})

// ---- isDoneClaim

test('isDoneClaim fires on plain verdicts', () => {
  for (const a of [
    'Done.', 'Fixed and pushed.', 'The migration is applied and the tests pass.', '**Done.** Not pushed yet.',
    'All tests passing.', 'It works now.', 'The site is live.', 'Committed as 3a9de26.',
  ]) expect(isDoneClaim(a)).toBe(true)
})

test('isDoneClaim does not fire on negations, questions, code or incidental words', () => {
  for (const a of [
    'Not done yet', "this isn't fixed", "I haven't pushed", 'This isn\u2019t fixed.', 'It still has not been applied.',
    'Is it done?', 'Should I push?', '```\ndone\nfixed\n```', 'Run `done` next.', 'Here is how it works', 'This is where the files live.',
    'I read the file and found the bug.', '',
  ]) expect(isDoneClaim(a)).toBe(false)
})

// ---- developByAsks (to-do 3f33...1b36: 14 pale claims in a session whose 10 asks were all witnessed)

/** A claim left pale by a write nothing can read back: an SQL function call classified other:*. */
const paleOnUnreadable = (turnId: string): Ledger => {
  const l = call(emptyLedger(), turnId, W('other', 'other:sql-function'))
  return turn(l, turnId, 'Done.').ledger
}

test('a claim whose matched asks are all witnessed develops, though its writes never can', () => {
  const l = paleOnUnreadable('t1')
  expect(l.claims[0]?.state).toBe('pale')
  const asks = [
    { claimId: 'c-t1', state: 'witnessed' },
    { claimId: 'c-t1', state: 'witnessed' },
    { claimId: null, state: 'open' },
  ]
  const after = developByAsks(l, asks)
  expect(after.claims[0]?.state).toBe('developed')
  expect(paleCount(after)).toBe(0)
  expect(after.writes).toEqual(l.writes)
})

test('one matched ask not yet witnessed, or dropped, keeps the claim pale', () => {
  const l = paleOnUnreadable('t1')
  expect(developByAsks(l, [{ claimId: 'c-t1', state: 'witnessed' }, { claimId: 'c-t1', state: 'claimed' }]).claims[0]?.state).toBe('pale')
  expect(developByAsks(l, [{ claimId: 'c-t1', state: 'witnessed' }, { claimId: 'c-t1', state: 'dropped' }]).claims[0]?.state).toBe('pale')
})

test('a claim no ask matched behaves exactly as before: same ledger, still pale', () => {
  const l = paleOnUnreadable('t1')
  const asks = [{ claimId: 'c-other', state: 'witnessed' }, { claimId: null, state: 'witnessed' }]
  expect(developByAsks(l, asks)).toBe(l)
  expect(developByAsks(l, []).claims[0]?.state).toBe('pale')
})

test('developByAsks never mutates and leaves developed claims alone', () => {
  const l = paleOnUnreadable('t1')
  const before = JSON.stringify(l)
  developByAsks(l, [{ claimId: 'c-t1', state: 'witnessed' }])
  expect(JSON.stringify(l)).toBe(before)
  let d = call(emptyLedger(), 't2', W('file', 'a.ts'))
  d = call(d, 't2', R('file', 'a.ts'))
  d = turn(d, 't2', 'Done.').ledger
  expect(d.claims[0]?.state).toBe('developed')
  expect(developByAsks(d, [{ claimId: 'c-t2', state: 'claimed' }])).toBe(d)
})

test('isDoneClaim judges the first done-word, in a clause of its own', () => {
  expect(isDoneClaim('No problem, done.')).toBe(true)
  expect(isDoneClaim('Not pushed yet. Everything else is done.')).toBe(false)
  expect(isDoneClaim('Is it done? Yes: fixed.')).toBe(true)
})
