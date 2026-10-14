import { test, expect, mock } from 'claude-code/testing'
import { SAFELIGHT } from './view'
import { BLUSH_MS, LAMP_MS } from './blush'
import { REFUSAL_RED_MS } from './refusal'
import { asRedSlot } from './redlog'

// witness 1.10.0 through the hooks module: amber below red, a refusal red for 10 s then amber,
// once per burst, and the red log with /reds. Plugin tests fake the engine, so whether the
// theme's `warning` key draws amber on the body is a live look owed after /reload-plugins.

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const DAY = Date.UTC(2026, 9, 11, 15, 0)
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const PROPS = { plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 115, isWorking: false, hasSurvey: false, maxRows: 30 } } as any
const HOOK =
  'PreToolUse:mcp__claude_ai_Supabase__execute_sql hook error: [python supabase-sql-verdict.py]: Refusing a write that would only reach the dialog.'
const ONE_ROW = "update workspace.t set a = 1 where id = 'a' returning id"
const REFUSED_WRITE = "delete from workspace.t where id = 'a' returning id"

function world(on: any, store: Map<string, unknown>, sql: () => { text: string; isError?: boolean }): any {
  const clock = mock.clock(on, { now: DAY })
  // A store the test can read back.
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
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
  on('tool.call', { tool: SQL }, () => ({ result: [], ...sql() }))
  return clock
}

const inks = async (band: any, color: string): Promise<number> =>
  (await band.findAll({ type: 'Text' })).filter((t: any) => t.props.color === color).length
const said = async (band: any, text: RegExp): Promise<number> => (await band.findAll({ type: 'Text', text })).length
const mounted = async ($: any): Promise<any> => $.ui.mount(PROPS)

test('a one-row write you can undo blushes amber, not red, for the 4 s floor', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, new Map(), () => ({ text: '[]' }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: ONE_ROW } as any)
  let band = await mounted($)
  expect(await said(band, /you can undo it/)).toBeGreaterThan(0)
  expect(await inks(band, 'warning')).toBeGreaterThan(0)
  expect(await inks(band, 'error')).toEqual(0)
  await band.unmount()
  expect(BLUSH_MS).toEqual(4000)
  await clock.advance(BLUSH_MS + 1)
  band = await mounted($)
  expect(await inks(band, 'warning')).toEqual(0)
  expect(await said(band, /SAFELIGHT/)).toEqual(0)
  await band.unmount()
})

test('a refusal is whole red for 10 s, then the rim stays amber with REFUSED until the next prompt', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = world(on, new Map(), () => ({ text: HOOK, isError: true }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: REFUSED_WRITE } as any)
  let band = await mounted($)
  expect(await inks(band, SAFELIGHT)).toBeGreaterThan(0)
  await band.unmount()
  await clock.advance(REFUSAL_RED_MS)
  band = await mounted($)
  expect(await inks(band, SAFELIGHT)).toEqual(0)
  expect(await inks(band, 'warning')).toBeGreaterThan(0)
  expect(await said(band, /REFUSED/)).toBeGreaterThan(0)
  await band.unmount()
  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as any)
  band = await mounted($)
  expect(await said(band, /REFUSED/)).toEqual(0)
  expect(await inks(band, 'warning')).toEqual(0)
  await band.unmount()
})

test('once per burst: a refusal while one is live stays amber, counts in the bubble, and is logged as a burst', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = world(on, store, () => ({ text: HOOK, isError: true }))
  await $.session.start(START)
  await clock.advance(LAMP_MS)
  await $.tool.call({ tool: SQL, project_id: 'p', query: REFUSED_WRITE } as any)
  await clock.advance(REFUSAL_RED_MS + 2_000)
  await $.tool.call({ tool: SQL, project_id: 'p', query: REFUSED_WRITE } as any)
  await $.tool.call({ tool: SQL, project_id: 'p', query: REFUSED_WRITE } as any)
  const band = await mounted($)
  expect(await inks(band, SAFELIGHT)).toEqual(0)
  expect(await inks(band, 'warning')).toBeGreaterThan(0)
  expect(await said(band, /REFUSED x3/)).toBeGreaterThan(0)
  await band.unmount()
  const slot = asRedSlot([...store.entries()].find(([k]) => k.startsWith('reds:'))?.[1])!
  const refusals = slot.events.filter((e) => e.channel === 'refusal')
  expect(refusals.map((e) => e.how)).toEqual([undefined, 'burst', 'burst'])
  expect(refusals[0]!.level).toEqual('red')
  expect(refusals[1]!.level).toEqual('amber')
})

test('the red log keeps when, channel, level, why, fix and how it ended; a prompt clears; /reds lists newest first', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = world(on, store, () => ({ text: HOOK, isError: true }))
  await $.session.start(START)
  await clock.advance(LAMP_MS + 1)
  await $.tool.call({ tool: SQL, project_id: 'p', query: REFUSED_WRITE } as any)
  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as any)
  const key = [...store.keys()].find((k) => k.startsWith('reds:'))!
  expect(key).toContain('me-111111')
  const slot = asRedSlot(store.get(key))!
  const lamp = slot.events.find((e) => e.channel === 'lamp')!
  expect(lamp.how).toEqual('lapsed')
  expect(lamp.fix).toContain('lamp test proves')
  const refusal = slot.events.find((e) => e.channel === 'refusal')!
  expect(refusal.level).toEqual('red')
  expect(refusal.how).toEqual('cleared')
  expect(refusal.why).toContain('supabase-sql-verdict.py')
  expect(refusal.fix).toContain('read the target back')
  const r: any = await $.command.run({ command: 'reds', args: '' } as any)
  const lines = String(r.text).split('\n')
  expect(lines[0]).toContain('events')
  expect(lines[1]).toContain('refusal red')
  expect(lines[1]).toMatch(/\[s[0-9a-f]{5}\]/)
  expect(lines[1]).toContain('cleared')
  // The refused call lit its blush first (amber, rung 1), which ended when the call failed.
  expect(lines[2]).toContain('blush amber r1')
  expect(lines[2]).toContain('failed')
  // The why names the call; the undo is said once, as the fix.
  expect(lines[2].split('| fix:')[0]).not.toContain('to undo')
  expect(lines[3]).toContain('lamp red')
})
