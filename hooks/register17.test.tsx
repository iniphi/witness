import { test, expect, mock } from 'claude-code/testing'
import { SAFELIGHT } from './view'
import { BLUSH_MS, LAMP_MS } from './blush'

// witness 1.7.0 through the hooks module: the safelight blush, the haemorrhage and the lamp test.
// Plugin tests fake the engine, so the real look of the blush cells in the person's theme at
// 8.6 pt, the lamp test's 1500 ms actually drawing, and the row count parsed from a real
// execute_sql result are a live look owed after /reload-plugins.

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const DAY = Date.UTC(2026, 9, 11, 15, 0)
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const PROPS = { plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 115, isWorking: false, hasSurvey: false, maxRows: 30 } } as any
const HOOK =
  'PreToolUse:mcp__claude_ai_Supabase__execute_sql hook error: [python supabase-sql-verdict.py]: Refusing a write that would only reach the dialog.'
const rows = (n: number): string => `<untrusted-data-1>\n${JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })))}\n</untrusted-data-1>`

function world(on: any, sqlText: () => { text: string; isError?: boolean }): any {
  const clock = mock.clock(on, { now: DAY })
  mock.store(on, {})
  mock.env(on, { USERPROFILE: 'C:\\Home\\u' })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me-111111' }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('tool.call', { tool: SQL }, () => ({ result: [], ...sqlText() }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: [], text: 'ok' }))
  return clock
}

const inks = async (band: any, color: string): Promise<number> =>
  (await band.findAll({ type: 'Text' })).filter((t: any) => t.props.color === color).length
const said = async (band: any, text: RegExp): Promise<number> => (await band.findAll({ type: 'Text', text })).length

test('the lamp test shows the whole creature red for 1500 ms at session start, with no bubble, then clears', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: '[]' }))
  await $.session.start(START)
  let band = await $.ui.mount(PROPS)
  expect(await inks(band, SAFELIGHT)).toBeGreaterThan(0)
  expect(await said(band, /SAFELIGHT|HAEMORRHAGE|REFUSED/)).toEqual(0)
  await band.unmount()
  await clock.advance(LAMP_MS)
  band = await $.ui.mount(PROPS)
  expect(await inks(band, SAFELIGHT)).toEqual(0)
  await band.unmount()
})

test('a git push blushes part of the shell and the bubble names the undo, for the floor after the result', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: '[]' }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as any)
  let band = await $.ui.mount(PROPS)
  expect(await inks(band, 'error')).toBeGreaterThan(0)
  expect(await inks(band, SAFELIGHT)).toEqual(0)
  expect(await said(band, /SAFELIGHT/)).toBeGreaterThan(0)
  expect(await said(band, /undo won't get it all back: git push/)).toBeGreaterThan(0)
  await band.unmount()
  await clock.advance(BLUSH_MS - 1)
  band = await $.ui.mount(PROPS)
  expect(await inks(band, 'error')).toBeGreaterThan(0)
  await band.unmount()
  await clock.advance(2)
  band = await $.ui.mount(PROPS)
  expect(await inks(band, 'error')).toEqual(0)
  expect(await said(band, /SAFELIGHT/)).toEqual(0)
  await band.unmount()
})

test('an ordinary call, an insert and a subagent push do not blush', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: '[]' }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as any)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "insert into workspace.t (a) values ('x')" } as any)
  await $.tool.call({ tool: 'Bash', command: 'git push --force', agentId: 'sub-1' } as any)
  const band = await $.ui.mount(PROPS)
  expect(await inks(band, 'error')).toEqual(0)
  expect(await said(band, /SAFELIGHT/)).toEqual(0)
  await band.unmount()
})

test('a bulk delete the database accepts blushes the top too (rung 3 without point-in-time recovery)', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: rows(2) }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "delete from workspace.t where status = 'x' returning id" } as any)
  const band = await $.ui.mount(PROPS)
  expect(await said(band, /nobody can undo it: DELETE not pinned to one row in workspace\.t/)).toBeGreaterThan(0)
  expect(await inks(band, 'error')).toBeGreaterThan(0)
  await band.unmount()
})

test('a call refused beneath takes the full red and the blush goes', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: HOOK, isError: true }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "delete from workspace.t where status = 'x' returning id" } as any)
  const band = await $.ui.mount(PROPS)
  expect(await said(band, /REFUSED/)).toBeGreaterThan(0)
  expect(await said(band, /nobody can undo it/)).toEqual(0)
  expect(await inks(band, 'error')).toEqual(0)
  expect(await inks(band, SAFELIGHT)).toBeGreaterThan(0)
  await band.unmount()
})

test('675 rows back from a statement that named 1 turns the whole creature red until the next prompt', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: rows(675) }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "update workspace.router_inbox set status = 'x' where id = 'a' returning id" } as any)
  let band = await $.ui.mount(PROPS)
  expect(await said(band, /HAEMORRHAGE/)).toBeGreaterThan(0)
  expect(await said(band, /675 rows came back from a statement that named 1 \(workspace\.router_inbox\)/)).toBeGreaterThan(0)
  expect(await inks(band, SAFELIGHT)).toBeGreaterThan(0)
  expect(await inks(band, 'error')).toEqual(0)
  await band.unmount()
  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as any)
  band = await $.ui.mount(PROPS)
  expect(await said(band, /HAEMORRHAGE/)).toEqual(0)
  expect(await inks(band, SAFELIGHT)).toEqual(0)
  await band.unmount()
})

test('a few rows from a pinned write is no haemorrhage', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, () => ({ text: rows(3) }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "update workspace.t set a = 1 where id = 'a' returning id" } as any)
  const band = await $.ui.mount(PROPS)
  expect(await said(band, /HAEMORRHAGE/)).toEqual(0)
  expect(await said(band, /you can undo it: UPDATE one row in workspace\.t/)).toBeGreaterThan(0)
  await band.unmount()
})
