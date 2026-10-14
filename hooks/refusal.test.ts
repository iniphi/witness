import { test, expect } from 'claude-code/testing'
import { REFUSAL_MS, REFUSAL_RED_MS, foldRefusal, isSqlWrite, refusalFrom, refusalLayer, refusalLive, refusalNotice, refusalRed } from './refusal'
import { buildView } from './view'

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const HOOK =
  'PreToolUse:mcp__claude_ai_Supabase__execute_sql hook error: [python supabase-sql-verdict.py]: Refusing a write that would only reach the dialog: it is not pinned by a UNIQUE key.'
const base = { tool: SQL, resultText: HOOK, isError: true, denied: false, agent: false }

test('isSqlWrite sees writes and not reads', () => {
  expect(isSqlWrite('UPDATE workspace.t SET a = 1 WHERE b = 2 RETURNING id')).toBe(true)
  expect(isSqlWrite('delete from workspace.t where x = 1')).toBe(true)
  expect(isSqlWrite('insert into workspace.t (a) values (1)')).toBe(true)
  expect(isSqlWrite('select * from workspace.t')).toBe(false)
  expect(isSqlWrite("select 'update me'")).toBe(false)
})

test('a PreToolUse hook error names the layer, the script and the reason', () => {
  const r = refusalLayer(HOOK, true, false)
  expect(r?.layer).toBe('a PreToolUse hook (supabase-sql-verdict.py)')
  expect(r?.reason.startsWith('Refusing a write that would only reach the dialog')).toBe(true)
})

test('a hook error with no script still names the layer', () => {
  const r = refusalLayer('PreToolUse:Bash hook error: Refusing git add -A.', true, false)
  expect(r).toEqual({ layer: 'a PreToolUse hook', reason: 'Refusing git add -A.' })
})

test('a permission denial names a permission rule', () => {
  const r = refusalLayer('Permission to use mcp__x__execute_sql has been denied.', true, false)
  expect(r?.layer).toBe('a permission rule or the auto-mode classifier')
})

test('the dialog cancel is a refusal only as the bare status', () => {
  expect(refusalLayer('{"status":"cancelled"}', false, false)?.layer).toBe('the Supabase dialog')
  expect(refusalLayer('[{"note":"cancelled"}]', false, false)).toBeNull()
})

test('an ordinary success or an unrelated error is no refusal', () => {
  expect(refusalLayer('[{"id":1}]', false, false)).toBeNull()
  expect(refusalLayer('ERROR: 42703: column "x" does not exist', true, false)).toBeNull()
})

test('a refused SQL write becomes a refusal, live for a bounded time', () => {
  const r = refusalFrom({ ...base, query: 'update workspace.t set a = 1 where b = 2 returning id' }, 1000, 'n1')
  expect(r?.layer).toBe('a PreToolUse hook (supabase-sql-verdict.py)')
  expect(r?.until).toBe(1000 + REFUSAL_MS)
  expect(r?.noticeId).toBe('n1')
  expect(refusalLive(r, 1000 + REFUSAL_MS - 1)).toBe(true)
  expect(refusalLive(r, 1000 + REFUSAL_MS)).toBe(false)
  expect(refusalLive(null, 0)).toBe(false)
})

test('a refused read, or a non-SQL tool, shows no red', () => {
  expect(refusalFrom({ ...base, query: 'select 1' }, 0, 'n')).toBeNull()
  expect(refusalFrom({ ...base, tool: 'Bash', query: 'update t set a = 1' }, 0, 'n')).toBeNull()
  expect(refusalFrom({ ...base, query: undefined }, 0, 'n')).toBeNull()
})

test('a deny from beneath with a reason is a refusal; a long reason is trimmed', () => {
  const long = 'x'.repeat(400)
  const r = refusalFrom({ ...base, query: 'delete from workspace.t where id = 1', resultText: long, isError: false, denied: true }, 5, 'n')
  expect(r?.layer).toBe('another guard')
  expect(r!.reason.length).toBeLessThanOrEqual(140)
})

test('the notice names the layer and says the witness did not hold it', () => {
  const r = refusalFrom({ ...base, query: 'update workspace.t set a = 1 where b = 2' }, 0, 'n')!
  const n = refusalNotice(r)
  expect(n.header).toBe('REFUSED')
  expect(n.text).toContain('refused by a PreToolUse hook (supabase-sql-verdict.py)')
  expect(n.text).toContain('The witness did not hold it')
  expect(refusalNotice(r, true).text.startsWith("A subagent's write")).toBe(true)
})

test('the view turns red and says REFUSED while a refusal is live, and not after', () => {
  const r = refusalFrom({ ...base, query: 'update workspace.t set a = 1 where b = 2' }, 0, 'n')!
  const input = {
    body: 'phi' as const,
    frameIndex: 0,
    ledger: { writes: [], claims: [], turns: {} },
    asks: [],
    activity: { activeMs: 0, lastAt: null },
    now: 10,
    speech: null,
    hold: null,
    barnacles: [],
    working: false,
    rowsLanded: false,
    maxRows: 0,
    bodyColumns: 120,
  }
  expect(buildView(input).safelight).toBe(false)
  const red = buildView({ ...input, refusal: r })
  expect(red.safelight).toBe(true)
  expect(red.status).toContain('REFUSED')
  const later = buildView({ ...input, now: REFUSAL_MS + 1, refusal: r })
  expect(later.safelight).toBe(false)
  expect(later.status).not.toContain('REFUSED')
})

test('once per burst (1.10.0): a refusal while one is live keeps the burst start, extends the window and counts', () => {
  const q = 'update workspace.t set a = 1 where b = 2'
  const first = refusalFrom({ ...base, query: q }, 1000, 'n1')!
  expect(refusalRed(first, 1000 + REFUSAL_RED_MS - 1)).toBe(true)
  expect(refusalRed(first, 1000 + REFUSAL_RED_MS)).toBe(false)
  const second = foldRefusal(first, refusalFrom({ ...base, query: q }, 5000, 'n2')!, 5000)
  expect(second.at).toEqual(1000)
  expect(second.until).toEqual(5000 + REFUSAL_MS)
  expect(second.count).toEqual(2)
  expect(second.noticeId).toEqual('n2')
  const third = foldRefusal(second, refusalFrom({ ...base, query: q }, 9000, 'n3')!, 9000)
  expect(third.count).toEqual(3)
  expect(refusalNotice(third).header).toEqual('REFUSED x3')
  expect(refusalNotice(first).header).toEqual('REFUSED')
  // a refusal after the window lapsed starts a new burst, and flashes red again
  const later = refusalFrom({ ...base, query: q }, 1000 + REFUSAL_MS + 5, 'n4')!
  expect(foldRefusal(first, later, later.at)).toEqual(later)
  expect(foldRefusal(null, later, later.at)).toEqual(later)
})
