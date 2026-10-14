import { test, expect } from 'claude-code/testing'
import {
  bareWrites,
  needsHold,
  statements,
  tablesRead,
  tablesWritten,
  withReturning,
  writerCalls,
} from './sql'
import { writerPattern } from './config'

test('bare UPDATE holds and gets a RETURNING wrapper', () => {
  const q = "UPDATE workspace.todo_mirror SET status='Done' WHERE id='x'"
  expect(needsHold(q)).toBe(true)
  expect(withReturning(q)).toEqual(
    "WITH w AS (UPDATE workspace.todo_mirror SET status='Done' WHERE id='x' RETURNING *) SELECT * FROM w",
  )
})

test('UPDATE with RETURNING does not hold', () => {
  const q = "UPDATE workspace.todo_mirror SET status='Done' WHERE id='x' RETURNING id"
  expect(needsHold(q)).toBe(false)
  expect(withReturning(q)).toBeNull()
})

test('DELETE drops the trailing semicolon', () => {
  const q = 'DELETE FROM workspace.inflight_claims WHERE id = 1;'
  expect(needsHold(q)).toBe(true)
  expect(withReturning(q)).toEqual(
    'WITH w AS (DELETE FROM workspace.inflight_claims WHERE id = 1 RETURNING *) SELECT * FROM w',
  )
})

test('CTE write with RETURNING is fine', () => {
  expect(needsHold('WITH u AS (UPDATE t SET a=1 WHERE id=2 RETURNING *) SELECT * FROM u')).toBe(false)
})

test('CTE write without RETURNING holds but is not wrappable', () => {
  const q = 'WITH d AS (DELETE FROM t WHERE x) SELECT 1'
  expect(needsHold(q)).toBe(true)
  expect(withReturning(q)).toBeNull()
  expect(bareWrites(q)[0]?.statement).toEqual('DELETE FROM t WHERE x')
})

test('writer function calls are not bare writes', () => {
  const q = "SELECT app.finish_task('abc', 'done')"
  const writers = writerPattern(['app.finish_task', 'app.log_*'])
  expect(needsHold(q)).toBe(false)
  expect(writerCalls(q)).toEqual([])
  expect(writerCalls(q, writers)).toEqual(['app.finish_task'])
  expect(writerCalls('SELECT app.log_open(1), app.log_close(2)', writers)).toEqual(['app.log_open', 'app.log_close'])
})

test('text in strings, comments and dollar bodies is ignored', () => {
  expect(needsHold("SELECT 'UPDATE t SET x=1'")).toBe(false)
  expect(needsHold('-- UPDATE t SET a=1\nSELECT 1')).toBe(false)
  expect(needsHold('/* DELETE FROM t */ SELECT 1')).toBe(false)
  expect(needsHold('SELECT $$DELETE FROM t$$')).toBe(false)
  expect(needsHold('SELECT $f$UPDATE t SET a=1$f$')).toBe(false)
})

test('RETURNING inside a string does not count', () => {
  expect(needsHold("UPDATE t SET note = 'has RETURNING in text' WHERE id=1")).toBe(true)
})

test('two statements with one bare UPDATE hold, no wrapper', () => {
  const q = "SELECT 1; UPDATE t SET a=1 WHERE id=2"
  expect(needsHold(q)).toBe(true)
  expect(withReturning(q)).toBeNull()
  expect(statements(q)).toEqual(['SELECT 1', 'UPDATE t SET a=1 WHERE id=2'])
})

test('case and quoted names', () => {
  expect(needsHold("update t set a = 1 where id = 2")).toBe(true)
  expect(needsHold("Delete From t Where x = 1")).toBe(true)
  const w = bareWrites('UPDATE "Weird"."Table" SET a = 1')
  expect(w[0]?.table).toEqual('weird.table')
  expect(tablesWritten('UPDATE "Weird"."Table" SET a = 1')).toEqual(['weird.table'])
})

test('trailing comment does not swallow RETURNING', () => {
  expect(withReturning('UPDATE t SET a=1 WHERE id=2 -- note')).toEqual(
    'WITH w AS (UPDATE t SET a=1 WHERE id=2 RETURNING *) SELECT * FROM w',
  )
})

test('upsert DO UPDATE and FOR UPDATE are not bare writes', () => {
  expect(needsHold('INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET b = 2')).toBe(false)
  expect(needsHold('SELECT * FROM t FOR UPDATE')).toBe(false)
})

test('tables: INSERT INTO ... SELECT ... FROM', () => {
  const q = 'INSERT INTO workspace.a (x) SELECT x FROM workspace.b'
  expect(tablesWritten(q)).toEqual(['workspace.a'])
  expect(tablesRead(q)).toEqual(['workspace.b'])
})

test('tables: UPDATE ... FROM', () => {
  const q = 'UPDATE a SET x = b.x FROM b WHERE a.id = b.id'
  expect(tablesWritten(q)).toEqual(['a'])
  expect(tablesRead(q)).toEqual(['b'])
})

test('tables: DELETE FROM x USING y', () => {
  const q = 'DELETE FROM x USING y WHERE x.id = y.id'
  expect(tablesWritten(q)).toEqual(['x'])
  expect(tablesRead(q)).toEqual(['y'])
})

test('tables: MERGE INTO and TRUNCATE', () => {
  expect(tablesWritten('MERGE INTO s.t USING s.u ON t.id = u.id WHEN MATCHED THEN DELETE')).toEqual(['s.t'])
  expect(tablesWritten('TRUNCATE TABLE a, s.b RESTART IDENTITY')).toEqual(['a', 's.b'])
})

test('tables: plain SELECT with JOINs', () => {
  const q = 'SELECT * FROM s.a x JOIN s.b y ON x.id = y.id LEFT JOIN c ON c.id = x.id'
  expect(tablesRead(q)).toEqual(['s.a', 's.b', 'c'])
  expect(tablesWritten(q)).toEqual([])
  expect(tablesRead('SELECT 1 FROM p, s.q z WHERE true')).toEqual(['p', 's.q'])
})

test('reads skip EXTRACT FROM and CTE names', () => {
  expect(tablesRead('SELECT extract(epoch FROM created_at) FROM s.t')).toEqual(['s.t'])
  expect(tablesRead('WITH w AS (SELECT 1 FROM s.a) SELECT * FROM w')).toEqual(['s.a'])
})

test('statements ignores empty and comment-only segments', () => {
  expect(statements('SELECT 1;; -- nothing\n; /* c */ ; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  expect(statements('')).toEqual([])
})

test('semicolon inside a string does not split', () => {
  expect(statements("SELECT 'a;b'; SELECT 2")).toEqual(["SELECT 'a;b'", 'SELECT 2'])
})

// The Adversary's BLOCKER (S162): an escaped quote in an E'' string ended the mask
// early, and the rewrite cut the WHERE off - an UPDATE of every row.
test('an E-string with an escaped quote keeps its WHERE in the CTE form', () => {
  const sql = "UPDATE workspace.notes SET body = E'it\\'s fixed' WHERE id = 42"
  expect(needsHold(sql)).toBe(true)
  expect(withReturning(sql)).toEqual(
    "WITH w AS (UPDATE workspace.notes SET body = E'it\\'s fixed' WHERE id = 42 RETURNING *) SELECT * FROM w",
  )
  const del = "DELETE FROM workspace.notes WHERE note = E'a\\'b' AND id = 7"
  expect(withReturning(del)).toContain('AND id = 7 RETURNING *')
})

test('the rewrite is refused, never guessed, when the text cannot be proved whole', () => {
  // A backslash in a standard string is literal: the quote after it closes, and the
  // stray quote that follows opens a string that never closes.
  expect(withReturning("UPDATE t SET a = 'x\\'s' WHERE id = 1")).toBeNull()
  expect(withReturning("UPDATE t SET a = 'unclosed WHERE id = 1")).toBeNull()
  expect(withReturning('UPDATE t SET a = 1 /* open comment WHERE id = 1')).toBeNull()
  // No WHERE: every row. Offer only let-through or cancel.
  expect(withReturning('UPDATE t SET a = 1')).toBeNull()
  expect(withReturning('DELETE FROM t')).toBeNull()
})

test('every CTE form carries the whole original statement', () => {
  const cases = [
    "UPDATE workspace.todo_mirror SET status='Done' WHERE id='x'",
    "UPDATE t SET note = 'has RETURNING; in text' WHERE id = 1;",
    'DELETE FROM workspace.inflight_claims WHERE id = 1 -- trailing comment',
    'UPDATE t SET a = 1 FROM u WHERE t.id = u.id AND u.k = 2',
  ]
  for (const sql of cases) {
    const fixed = withReturning(sql)
    expect(fixed).not.toBeNull()
    const core = sql.replace(/\s*--.*$/, '').replace(/;\s*$/, '').trim()
    expect(fixed).toContain(core)
  }
})
