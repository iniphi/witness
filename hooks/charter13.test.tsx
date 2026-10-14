import { test, expect, mock } from 'claude-code/testing'

// witness 1.11: the first-week budget in /jewels and the Barnacles pointer. Plugin tests fake the
// engine, so how the pane reads live is owed a look after /reload-plugins.

const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const KEY = 'candidates:c:/work/proj'
const mk = (n: number, at: number) => ({ key: `hook:j${n}`, kind: 'hook', title: `Jewel ${n}`, why: 'w', evidence: 'e', at, filed: false })

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
}

test('a new install shows three jewels, says how many are queued, and shows the rest later', { timeoutMs: 15_000 }, async ($, on) => {
  const list = [1, 2, 3, 4, 5].map(n => mk(n, 950_000 + n))
  world(on, new Map<string, unknown>([[KEY, list], ['install:firstScanAt', 900_000]]))
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'jewels', args: '' } as any)
  const text = String(r.text)
  expect(text).toContain('3 jewels proposed')
  expect(text).toContain('2 more queued (first-week budget)')
  expect(text).toContain('Jewel 1')
  expect(text).not.toContain('Jewel 5')
})

test('without an install time, or after the week, nothing is queued', { timeoutMs: 15_000 }, async ($, on) => {
  const list = [1, 2, 3, 4, 5].map(n => mk(n, 950_000 + n))
  world(on, new Map<string, unknown>([[KEY, list]]))
  await $.session.start(START)
  const text = String(((await $.command.run({ command: 'jewels', args: '' } as any)) as any).text)
  expect(text).toContain('5 jewels proposed')
  expect(text).not.toContain('queued')
})
