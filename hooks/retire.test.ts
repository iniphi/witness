import { test, expect, mock } from 'claude-code/testing'

import type { Candidate } from '../types'
import { dismissedTitles } from './charter'
import { settledCounts, jewelsList } from './jewels'
import { candidatesSection, retireStrays, unsettled } from './notes'

// witness 1.11.1: "Repo root, retire stray". A retired jewel is never shown, never counted, and
// never fed to the generator as a dismissed shape.

const cand = (key: string, over: Partial<Candidate> = {}): Candidate => ({
  key,
  kind: 'skill',
  title: `title ${key}`,
  why: 'why',
  evidence: 'ev',
  at: 1000,
  filed: false,
  ...over,
})

test('retireStrays retires every unsettled stray jewel and keeps the project\'s own settles', () => {
  const own = [cand('a', { settled: { how: 'taken', at: 5 } }), cand('b')]
  const stray = [cand('a'), cand('c'), cand('d', { settled: { how: 'dismissed', at: 7 } })]
  const got = retireStrays(own, [stray], 99)
  const by = Object.fromEntries(got.map(c => [c.key, c]))
  expect(by.a!.settled).toEqual({ how: 'taken', at: 5 })
  expect(by.b!.settled).toBeUndefined()
  expect(by.c!.settled).toEqual({ how: 'retired', at: 99 })
  expect(by.c!.filed).toBe(true)
  expect(by.d!.settled).toEqual({ how: 'dismissed', at: 7 })
})

test('a retired jewel is not shown, not counted, not in the print, and not a dismissed shape', () => {
  const list = [cand('a', { settled: { how: 'retired', at: 1 } }), cand('b')]
  expect(unsettled(list).map(c => c.key)).toEqual(['b'])
  expect(jewelsList(list).map(c => c.key)).toEqual(['b'])
  expect(settledCounts(list)).toEqual({ built: 0, taken: 0, dismissed: 0 })
  expect(dismissedTitles([list])).toEqual([])
  expect(candidatesSection(list, 0).join('\n')).not.toContain('title a')
})

test('retireStrays is idempotent and never evicts the project\'s own jewels past the cap', () => {
  const own = Array.from({ length: 38 }, (_, i) => cand(`o${i}`))
  const stray = Array.from({ length: 10 }, (_, i) => cand(`s${i}`, { at: i }))
  const once = retireStrays(own, [stray], 50)
  expect(own.every(o => once.some(c => c.key === o.key))).toBe(true)
  expect(retireStrays(once, [stray], 60)).toEqual(once)
  expect(retireStrays(Array.from({ length: 40 }, (_, i) => cand(`o${i}`)), [stray], 1).some(c => c.key.startsWith('s'))).toBe(false)
})

const DAY = Date.UTC(2026, 9, 11, 15, 0)

function world(on: any, store: Map<string, unknown>, git: ReadonlySet<string>): void {
  mock.clock(on, { now: DAY })
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
  on('fs.exists', (_$: any, e: any) => ({ value: git.has(String(e.path).replace(/\\/g, '/').toLowerCase()) }))
}

test('a session started in a subfolder folds the stray candidates slots into the repo slot, once', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([
    ['candidates:d:/work/proj', [cand('a'), cand('own', { settled: { how: 'taken', at: 3 } })]],
    ['candidates:d:/work/proj/mods/witness/hooks', [cand('own'), cand('x'), cand('y', { settled: { how: 'dismissed', at: 4 } })]],
    ['candidates:d:/work/proj/mods', [cand('z')]],
    ['candidates:d:/work/proj/vendor/inner', [cand('inner')]],
    ['candidates:d:/work/projother', [cand('keep')]],
    ['friction:d:/work/proj/mods/witness/hooks', [{ key: 'f' }]],
  ])
  world(on, store, new Set(['d:/work/proj/.git', 'd:/work/proj/vendor/inner/.git']))
  await $.session.start({ cwd: 'D:\\Work\\Proj\\mods\\witness\\hooks', surface: 'terminal', isInteractive: true })
  const got = store.get('candidates:d:/work/proj') as Candidate[]
  const by = Object.fromEntries(got.map(c => [c.key, c.settled?.how ?? 'open']))
  expect(by).toEqual({ a: 'open', own: 'taken', x: 'retired', y: 'dismissed', z: 'retired' })
  expect(store.has('candidates:d:/work/proj/mods/witness/hooks')).toBe(false)
  expect(store.has('candidates:d:/work/proj/mods')).toBe(false)
  // A nested repository and a sibling folder are not strays; other slots are untouched.
  expect(store.has('candidates:d:/work/proj/vendor/inner')).toBe(true)
  expect(store.has('candidates:d:/work/projother')).toBe(true)
  expect(store.has('friction:d:/work/proj/mods/witness/hooks')).toBe(true)
  const before = JSON.stringify(got)
  await $.session.start({ cwd: 'd:/work/proj', surface: 'terminal', isInteractive: true })
  expect(JSON.stringify(store.get('candidates:d:/work/proj'))).toEqual(before)
})
