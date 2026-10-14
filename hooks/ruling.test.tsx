import { test, expect } from 'claude-code/testing'

import type { Candidate } from '../types'
import { dismissedTitles } from './charter'
import { jewelsText, settledCounts, settledLine } from './jewels'
import { mergeCandidatesByKey } from './notes'
import { isDismissed, parseRuling, ruleIn, rulingList, rulingText } from './ruling'

// witness 1.12: a calibrated jewel carries its ruling (built or dismissed) on top of the `taken`
// settle that `calibrate all` writes. Plugin tests fake the engine, so how the page reads in the
// person's terminal is a live look owed after /reload-plugins.

const base = { kind: 'hook', why: 'w', evidence: 'e', filed: false } as const
const mk = (n: number, settled?: Candidate['settled'], ruled?: Candidate['ruled']): Candidate => ({
  ...base,
  key: `hook:j${n}`,
  title: `Jewel ${n}`,
  at: n * 10,
  ...(settled === undefined ? {} : { settled }),
  ...(ruled === undefined ? {} : { ruled }),
})

const taken = (n: number) => mk(n, { how: 'taken', at: 5 })

test('an old-shaped record (no ruled field) reads exactly as before', () => {
  const old = [mk(1, { how: 'taken', at: 5 }), mk(2, { how: 'dismissed', at: 6 }), mk(3, { how: 'retired', at: 7 }), mk(4)]
  expect(settledCounts(old)).toEqual({ built: 0, taken: 1, dismissed: 1 })
  expect(dismissedTitles([old])).toEqual(['Jewel 2'])
  expect(isDismissed(old[0] as Candidate)).toBe(false)
  expect(isDismissed(old[1] as Candidate)).toBe(true)
})

test('counts split taken, built and dismissed, a ruled dismissal counting as dismissed', () => {
  const list = [
    taken(1),
    mk(2, { how: 'taken', at: 5 }, { how: 'built', at: 9 }),
    mk(3, { how: 'taken', at: 5 }, { how: 'dismissed', at: 9 }),
    mk(4, { how: 'dismissed', at: 6 }),
    mk(5),
  ]
  expect(settledCounts(list)).toEqual({ built: 1, taken: 1, dismissed: 2 })
})

test('a ruled field on a jewel that is not taken is ignored by the counts', () => {
  const odd = [mk(1, undefined, { how: 'built', at: 9 }), mk(2, { how: 'dismissed', at: 6 }, { how: 'built', at: 9 })]
  expect(settledCounts(odd)).toEqual({ built: 0, taken: 0, dismissed: 1 })
})

test('settledLine reads built, taken, dismissed', () => {
  const list = [taken(1), mk(2, { how: 'taken', at: 5 }, { how: 'built', at: 9 }), mk(3, { how: 'dismissed', at: 6 })]
  expect(settledLine(list)).toBe('Settled: built 1, taken 1, dismissed 1.')
  expect(jewelsText([], 1000)).toContain('Settled: built 0, taken 0, dismissed 0.')
})

test('rulingList numbers the taken jewels in a stable order, ruled ones included', () => {
  const list = [mk(3, { how: 'taken', at: 5 }, { how: 'built', at: 9 }), taken(1), mk(2), mk(4, { how: 'dismissed', at: 6 }), taken(5)]
  expect(rulingList(list).map(c => c.key)).toEqual(['hook:j1', 'hook:j3', 'hook:j5'])
})

test('rule taken -> built', () => {
  const list = [taken(1), taken(2)]
  const r = ruleIn(list, ['1'], 'built', 99)
  expect(r.next[0]?.ruled).toEqual({ how: 'built', at: 99 })
  expect(r.next[0]?.settled).toEqual({ how: 'taken', at: 5 })
  expect(r.next[1]?.ruled).toBeUndefined()
  expect(r.lines).toEqual(['Ruled built: Jewel 1'])
  expect(list[0]?.ruled).toBeUndefined()
})

test('rule taken -> dismissed, by key', () => {
  const r = ruleIn([taken(1), taken(2)], ['hook:j2'], 'dismissed', 99)
  expect(r.next[1]?.ruled).toEqual({ how: 'dismissed', at: 99 })
  expect(r.lines).toEqual(['Ruled dismissed: Jewel 2'])
})

test('several refs in one command are resolved against the same snapshot', () => {
  const r = ruleIn([taken(1), taken(2), taken(3)], ['1', '3'], 'built', 99)
  expect(r.next.map(c => c.ruled?.how)).toEqual(['built', undefined, 'built'])
})

test('a ruling is idempotent: the same ruling again changes nothing and says so', () => {
  const once = ruleIn([taken(1)], ['1'], 'built', 99).next
  const twice = ruleIn(once, ['1'], 'built', 123)
  expect(twice.next).toEqual(once)
  expect(twice.next[0]?.ruled?.at).toBe(99)
  expect(twice.lines).toEqual(['Already ruled built: Jewel 1'])
})

test('a ruling is never changed: built to dismissed and dismissed to built are refused', () => {
  const built = [mk(1, { how: 'taken', at: 5 }, { how: 'built', at: 9 })]
  const gone = [mk(1, { how: 'taken', at: 5 }, { how: 'dismissed', at: 9 })]
  const a = ruleIn(built, ['1'], 'dismissed', 99)
  expect(a.next).toEqual(built)
  expect(a.lines).toEqual(['Not changed: Jewel 1 is already ruled built.'])
  const b = ruleIn(gone, ['1'], 'built', 99)
  expect(b.next).toEqual(gone)
  expect(b.lines).toEqual(['Not changed: Jewel 1 is already ruled dismissed.'])
})

test('only a taken jewel is ruled: unsettled, dismissed and retired are refused', () => {
  const list = [mk(1), mk(2, { how: 'dismissed', at: 6 }), mk(3, { how: 'retired', at: 6 })]
  const r = ruleIn(list, ['hook:j1', 'hook:j2', 'hook:j3'], 'built', 99)
  expect(r.next).toEqual(list)
  expect(r.lines).toEqual([
    'Refused: Jewel 1 is not settled; only a taken jewel is ruled.',
    'Refused: Jewel 2 is dismissed; only a taken jewel is ruled.',
    'Refused: Jewel 3 is retired; only a taken jewel is ruled.',
  ])
})

test('an unknown number or key is named', () => {
  const r = ruleIn([taken(1)], ['7', 'hook:nope'], 'built', 99)
  expect(r.lines).toEqual(['No jewel 7 among the taken ones.', 'No jewel hook:nope among the taken ones.'])
})

test('dismissedTitles includes jewels ruled dismissed; built ones are not dismissed', () => {
  const list = [
    mk(1, { how: 'taken', at: 5 }, { how: 'dismissed', at: 9 }),
    mk(2, { how: 'taken', at: 5 }, { how: 'built', at: 9 }),
    taken(3),
    mk(4, { how: 'dismissed', at: 6 }),
  ]
  expect(dismissedTitles([list])).toEqual(['Jewel 1', 'Jewel 4'])
})

test('mergeCandidatesByKey keeps a ruling a stale copy lacks', () => {
  const stored = [mk(1, { how: 'taken', at: 5 }, { how: 'built', at: 9 })]
  const merged = mergeCandidatesByKey(stored, [taken(1)])
  expect(merged[0]?.ruled).toEqual({ how: 'built', at: 9 })
})

test('parseRuling reads the /jewels sub-forms', () => {
  expect(parseRuling(undefined)).toEqual({ kind: 'open' })
  expect(parseRuling('  ')).toEqual({ kind: 'open' })
  expect(parseRuling('taken')).toEqual({ kind: 'list' })
  expect(parseRuling('built 1 3')).toEqual({ kind: 'rule', how: 'built', refs: ['1', '3'] })
  expect(parseRuling('Dismissed 2,5')).toEqual({ kind: 'rule', how: 'dismissed', refs: ['2', '5'] })
  expect(parseRuling('dismiss hook:j1')).toEqual({ kind: 'rule', how: 'dismissed', refs: ['hook:j1'] })
  expect(parseRuling('built')).toEqual({ kind: 'usage' })
  expect(parseRuling('frobnicate 1')).toEqual({ kind: 'usage' })
})

test('rulingText lists the taken jewels with number, state and key', () => {
  const list = [taken(1), mk(2, { how: 'taken', at: 5 }, { how: 'built', at: 9 })]
  expect(rulingText(list)).toEqual(
    ['2 jewels were taken (/jewels built N | /jewels dismissed N):', '1. [taken] Hook: Jewel 1 (hook:j1)', '2. [built] Hook: Jewel 2 (hook:j2)'].join('\n'),
  )
  expect(rulingText([mk(1)])).toBe('No jewel has been taken yet, so none is waiting for a ruling.')
})
