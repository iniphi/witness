import { test, expect, mock } from 'claude-code/testing'
import { SAFELIGHT } from './view'

// witness 1.4.0 through the hooks module: a write refused BENEATH the witness (a PreToolUse hook's
// error comes back as the result of next) turns the band red and names the layer. Plugin tests
// fake the engine, so the real order of the engine's tool.call and the settings hooks, and the
// real text of a hook denial, are a live look owed after /reload-plugins.

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const DAY = Date.UTC(2026, 9, 11, 15, 0)
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const WITH_RETURNING = "UPDATE workspace.todo_mirror SET status='Done' WHERE title LIKE 'x%' RETURNING id"
const HOOK =
  'PreToolUse:mcp__claude_ai_Supabase__execute_sql hook error: [python supabase-sql-verdict.py]: Refusing a write that would only reach the dialog.'
const PROPS = { plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 115, isWorking: false, hasSurvey: false, maxRows: 30 } } as any

function world(on: any, beneath: () => any): void {
  mock.clock(on, { now: DAY })
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
  on('tool.call', { tool: SQL }, beneath)
}

test('a RETURNING write refused by a hook beneath turns the band red and names the layer', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, () => ({ result: [], text: HOOK, isError: true }))
  await $.session.start(START)
  await $.tool.call({ tool: SQL, project_id: 'p', query: WITH_RETURNING } as any)
  const band = await $.ui.mount(PROPS)
  expect(await band.find({ type: 'Text', text: /REFUSED/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /PreToolUse hook \(supabase-sql-verdict\.py\)/ })).toBeDefined()
  expect(await band.find({ type: 'Text', color: SAFELIGHT } as any)).toBeDefined()
  await band.unmount()
})

test('the next prompt takes the red away', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, () => ({ result: [], text: HOOK, isError: true }))
  await $.session.start(START)
  await $.tool.call({ tool: SQL, project_id: 'p', query: WITH_RETURNING } as any)
  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as any)
  const band = await $.ui.mount(PROPS)
  expect((await band.findAll({ type: 'Text', text: /REFUSED/ })).length).toEqual(0)
  await band.unmount()
})

test('a write that goes through, and a refused read, show no red', async ($, on) => {
  world(on, () => ({ result: [], text: '<untrusted-data-1>\n[{"id":"x"}]\n</untrusted-data-1>' }))
  await $.session.start(START)
  await $.tool.call({ tool: SQL, project_id: 'p', query: WITH_RETURNING } as any)
  await $.tool.call({ tool: SQL, project_id: 'p', query: 'select 1' } as any)
  const band = await $.ui.mount(PROPS)
  expect((await band.findAll({ type: 'Text', text: /REFUSED/ })).length).toEqual(0)
  await band.unmount()
})
