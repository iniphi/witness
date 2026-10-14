import { test, expect } from 'claude-code/testing'
import { effectTablePattern } from './config'
import { returningWrites, rowsNamed, undoOf } from './irreversible'
import type { UndoInput } from './irreversible'

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const MIGRATE = 'mcp__claude_ai_Supabase__apply_migration'

const sql = (query: string, over: Partial<UndoInput> = {}, tool = SQL) =>
  undoOf({ tool, input: { query }, push: null, pitr: false, ...over })
const sh = (command: string, push: string | null = null, tool = 'Bash') =>
  undoOf({ tool, input: { command }, push, pitr: false })

test('DROP TABLE, SCHEMA, VIEW, FUNCTION and COLUMN lose data: rung 3 without point-in-time recovery, 2 with it', () => {
  for (const q of ['drop table workspace.x', 'DROP SCHEMA s CASCADE', 'drop view v', 'drop function f(int)', 'alter table workspace.x drop column y']) {
    expect(sql(q)?.rung).toEqual(3)
    expect(sql(q, { pitr: true })?.rung).toEqual(2)
  }
  const drop = sql('drop table if exists workspace.x')!
  expect(drop.what).toEqual('DROP TABLE workspace.x')
  expect(drop.undo).toContain('a reverting migration brings back the schema, not the rows in workspace.x')
  expect(sql('alter table t drop column c')!.undo).toContain('not the rows in t.c')
  expect(sql('drop table t', { pitr: true })!.undo).toEqual('only a point-in-time restore brings the rows back, and it restores the whole project')
})

test('a constraint drop is not a data loss', () => {
  expect(sql('alter table t drop constraint c')).toBeNull()
})

test('TRUNCATE is a loss; an unpinned DELETE or UPDATE is a loss; a bare-WHERE one too', () => {
  expect(sql('truncate workspace.t')?.rung).toEqual(3)
  expect(sql('delete from workspace.t')?.rung).toEqual(3)
  expect(sql("update workspace.t set a = 1 where status = 'x' and b > 3 returning id")?.rung).toEqual(3)
  expect(sql("delete from workspace.t where status = 'x' returning id", { pitr: true })?.rung).toEqual(2)
  expect(sql('update workspace.t set a = 1')!.what).toEqual('UPDATE not pinned to one row in workspace.t')
})

test('a write pinned to one literal key with RETURNING is rung 1 and says how to undo it', () => {
  const u = sql("update workspace.t set a = 1 where id = 'abc' returning id")!
  expect(u.rung).toEqual(1)
  expect(u.what).toEqual('UPDATE one row in workspace.t')
  expect(u.undo).toContain('RETURNING shows it as it is now; to undo, write its old values back')
  expect(sql("delete from workspace.t where id = 'a'::uuid returning *")?.rung).toEqual(1)
  expect(sql('delete from t where 7 = id returning id')?.rung).toEqual(1)
})

test('a single equality on a column that is not named like a key is not one row: the witness cannot see UNIQUE indexes', () => {
  expect(sql("update t set a = 1 where status = 'x' returning id")?.rung).toEqual(3)
  expect(sql("update t set a = 1 where user_id = 'x' returning id")?.rung).toEqual(1)
  expect(sql("update t set a = 1 where t.slug = 'x' returning id")?.rung).toEqual(1)
})

test('pinned but with no RETURNING is not rung 1: nothing shows what it changed', () => {
  expect(sql("update t set a = 1 where id = 'x'")?.rung).toEqual(3)
})

test('a CTE-wrapped write is read inside its body', () => {
  expect(sql("with w as (update t set a = 1 where id = 'x' returning id) select * from w")?.rung).toEqual(1)
  expect(sql('with w as (delete from t where a > 1 returning id) select * from w')?.rung).toEqual(3)
})

test('INSERT, SELECT and writer-function calls are not irreversible here', () => {
  expect(sql("insert into workspace.t (a) values ('x')")).toBeNull()
  expect(sql('select * from workspace.t')).toBeNull()
  expect(sql('select app.finish_task(1)')).toBeNull()
  expect(sql("insert into t values (1) on conflict (id) do update set a = 2")).toBeNull()
  expect(sql('')).toBeNull()
})

test('an additive-only migration is rung 1; one with a destructive statement takes the destructive rung', () => {
  const add = sql('create table t (a int); create index i on t (a); alter table t add column b int; comment on table t is $$x$$; grant select on t to r;', {}, MIGRATE)!
  expect(add.rung).toEqual(1)
  expect(add.undo).toEqual('a reverting migration takes out what this added')
  expect(undoOf({ tool: MIGRATE, input: { name: 'add_t', query: 'create or replace function f() returns int language sql as $$ select 1 $$' }, push: null, pitr: false })!.what).toEqual('migration add_t (additive only)')
  const mixed = sql('create table t (a int); drop table old_t;', {}, MIGRATE)!
  expect(mixed.rung).toEqual(3)
  expect(sql('create table t (a int); drop table old_t;', { pitr: true }, MIGRATE)!.rung).toEqual(2)
  expect(sql('create table t (a int); delete from t;', {}, MIGRATE)!.rung).toEqual(3)
})

test('a migration is read from its statements, whatever its tool; execute_sql DDL that only adds is not flagged', () => {
  expect(sql('create table t (a int)')).toBeNull()
  expect(sql('do $$ begin delete from t; end $$', {}, MIGRATE)!.rung).toEqual(3)
  expect(sql('do $$ begin null; end $$')).toBeNull()
  expect(sql('drop table t', {}, 'mcp__other__apply_migration')!.rung).toEqual(3)
})

test('a quoted DROP, or one in a comment, is not a statement', () => {
  expect(sql("select 'drop table x'")).toBeNull()
  expect(sql('-- drop table x\nselect 1')).toBeNull()
})

test('git push with --force, -f, --force-with-lease or a +refspec is rung 3', () => {
  for (const c of ['git push --force', 'git push -f origin main', 'git push --force-with-lease origin main', 'git push origin +main', 'git push -fu origin main', 'git -C repo push --force']) {
    expect(sh(c, 'UNMETERED')?.rung).toEqual(3)
  }
  expect(sh('git push -f', null)!.undo).toContain('only a clone that still has them can restore them')
})

test('a plain git push follows the metered verdict word, and never claims what it did not check', () => {
  const metered = sh('git push origin main', 'METERED')!
  expect(metered.rung).toEqual(2)
  expect(metered.undo).toContain('the build it started is not undone (metered register)')
  const clean = sh('git push', 'UNMETERED')!
  expect(clean.rung).toEqual(1)
  expect(clean.undo).toContain('no build is registered behind this repo (metered register)')
  for (const word of ['UNKNOWN', 'NO REGISTER', null, '?']) {
    const u = sh('git push', word)!
    expect(u.rung).toEqual(2)
    expect(u.undo).toContain('builds and webhooks behind this repo: not checked')
  }
})

test('the push is read from the command, not a regex over the line', () => {
  expect(sh('git commit -m "git push --force" && git status', 'UNMETERED')).toBeNull()
  expect(sh('echo git push', 'UNMETERED')).toBeNull()
  expect(sh('cd x && git add a && git push', 'UNMETERED')?.rung).toEqual(1)
  expect(sh('git push --dry-run -f', 'UNMETERED')).toBeNull()
  expect(sh('git push -u origin main', 'UNMETERED', 'PowerShell')?.rung).toEqual(1)
})

test('other shell commands, filesystem deletes, git reset and Notion writes are null in v1', () => {
  expect(sh('rm -rf build')).toBeNull()
  expect(sh('git reset --hard HEAD~3')).toBeNull()
  expect(sh('git clean -fdx')).toBeNull()
  expect(undoOf({ tool: 'mcp__claude_ai_Notion__notion-update-page', input: { page_id: 'x' }, push: null, pitr: false })).toBeNull()
  expect(undoOf({ tool: 'Read', input: {}, push: null, pitr: false })).toBeNull()
})

test('an outgoing email is rung 3, and only on a Gmail-like server', () => {
  for (const t of ['send_message', 'reply', 'forward']) {
    const u = undoOf({ tool: `mcp__claude_ai_Gmail__${t}`, input: {}, push: null, pitr: false })!
    expect(u.rung).toEqual(3)
    expect(u.undo).toEqual('sent: nobody can unsend it')
  }
  expect(undoOf({ tool: 'mcp__claude_ai_Gmail__create_draft', input: {}, push: null, pitr: false })).toBeNull()
  expect(undoOf({ tool: 'mcp__chat__send_message', input: {}, push: null, pitr: false })).toBeNull()
})

test('effectTables: a write to a listed table is at least rung 2 and says why; a bulk one stays rung 3', () => {
  const effectTables = effectTablePattern(['workspace.router_inbox'])
  const pinned = sql("update workspace.router_inbox set status = 'x' where id = 'a' returning id", { effectTables })!
  expect(pinned.rung).toEqual(2)
  expect(pinned.undo).toContain('a trigger on workspace.router_inbox can reach outside the database; undoing the row does not undo what it sent (effectTables)')
  expect(pinned.undo).toContain('write its old values back;')
  expect(sql('delete from workspace.router_inbox', { effectTables })?.rung).toEqual(3)
  expect(sql('delete from workspace.router_inbox', { effectTables, pitr: true })?.rung).toEqual(2)
  const ins = sql("insert into workspace.router_inbox (a) values ('x')", { effectTables })!
  expect(ins.rung).toEqual(2)
  expect(ins.what).toEqual('INSERT into workspace.router_inbox')
})

test('a write to an unlisted table keeps its rung and says its triggers are not in effectTables; an unlisted INSERT is null', () => {
  const effectTables = effectTablePattern(['workspace.router_inbox'])
  const u = sql("update workspace.todo set a = 1 where id = 'a' returning id", { effectTables })!
  expect(u.rung).toEqual(1)
  expect(u.undo.endsWith('; triggers on workspace.todo are not in effectTables')).toBe(true)
  expect(sql('delete from workspace.todo', { effectTables })!.undo).toContain('triggers on workspace.todo are not in effectTables')
  expect(sql("insert into workspace.todo (a) values ('x')", { effectTables })).toBeNull()
  expect(sql("update workspace.todo set a = 1 where id = 'a' returning id")!.undo).toContain('triggers on workspace.todo are not in effectTables')
})

test('effectTablePattern: wildcards anywhere, a bare name in any schema, blank means none', () => {
  const p = effectTablePattern(['workspace.router_*', 'orders'])!
  expect(p.test('workspace.router_inbox')).toBe(true)
  expect(p.test('public.orders')).toBe(true)
  expect(p.test('orders')).toBe(true)
  expect(p.test('workspace.todo')).toBe(false)
  expect(effectTablePattern([])).toBeNull()
  expect(effectTablePattern(['bad name!'])).toBeNull()
})

test('rowsNamed: a key is 1, an IN list is its length, anything else is 1', () => {
  expect(rowsNamed("id = 'a'")).toEqual(1)
  expect(rowsNamed("id in ('a', 'b', 'c')")).toEqual(3)
  expect(rowsNamed('id in (select id from x)')).toEqual(1)
  expect(rowsNamed("status = 'x'")).toEqual(1)
  expect(rowsNamed(null)).toEqual(1)
})

test('returningWrites lists only the writes that carry RETURNING, with what they named', () => {
  expect(returningWrites("update t set a = 1 where id in ('a','b','c') returning id")).toEqual([{ verb: 'UPDATE', table: 't', named: 3 }])
  expect(returningWrites('update t set a = 1')).toEqual([])
  expect(returningWrites('select 1')).toEqual([])
})
