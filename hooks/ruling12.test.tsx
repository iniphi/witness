import { test, expect, mock } from 'claude-code/testing'

// witness 1.12: the /jewels sub-forms that rule a calibrated jewel, through the registered
// command and the store. Plugin tests fake the engine, so the pane's settled line as drawn is a
// live look owed after /reload-plugins.

const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const KEY = 'candidates:c:/work/proj'
const one = { key: 'hook:a', kind: 'hook', title: 'Alpha guard', why: 'w', evidence: 'e', at: 10, filed: true, settled: { how: 'taken', at: 5 } }
const two = { key: 'skill:b', kind: 'skill', title: 'Beta routine', why: 'w', evidence: 'e', at: 20, filed: true, settled: { how: 'taken', at: 5 } }
const open = { key: 'hook:c', kind: 'hook', title: 'Gamma open', why: 'w', evidence: 'e', at: 30, filed: false }

function world(on: any, store: Map<string, unknown>): void {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
}

const run = async ($: any, args: string): Promise<string> => String(((await $.command.run({ command: 'jewels', args } as any)) as any).text)

test('/jewels taken lists the taken jewels; built and dismissed rule them and the page counts them', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [one, two, open]]])
  world(on, store)
  await $.session.start(START)
  expect(await run($, 'taken')).toContain('1. [taken] Hook: Alpha guard (hook:a)')
  expect(await run($, 'built 1')).toEqual('Ruled built: Alpha guard')
  expect(await run($, 'dismissed 2')).toEqual('Ruled dismissed: Beta routine')
  const list = store.get(KEY) as any[]
  expect(list.find(c => c.key === 'hook:a').ruled.how).toEqual('built')
  expect(list.find(c => c.key === 'skill:b').ruled.how).toEqual('dismissed')
  expect(list.find(c => c.key === 'skill:b').settled.how).toEqual('taken')
  expect(await run($, '')).toContain('Settled: built 1, taken 0, dismissed 1.')
})

test('a re-ruling through the command is idempotent and a change of ruling is refused', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [one, two]]])
  world(on, store)
  await $.session.start(START)
  await run($, 'built 1')
  const after = JSON.stringify(store.get(KEY))
  expect(await run($, 'built 1')).toEqual('Already ruled built: Alpha guard')
  expect(await run($, 'dismissed 1')).toEqual('Not changed: Alpha guard is already ruled built.')
  expect(JSON.stringify(store.get(KEY))).toEqual(after)
})

test('an unsettled jewel and a bad form are refused without writing', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [one, open]]])
  world(on, store)
  await $.session.start(START)
  const before = JSON.stringify(store.get(KEY))
  expect(await run($, 'built hook:c')).toContain('Refused: Gamma open is not settled')
  expect(await run($, 'built')).toContain('Usage:')
  expect(JSON.stringify(store.get(KEY))).toEqual(before)
})
