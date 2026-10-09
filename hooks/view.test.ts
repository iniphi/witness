import { test, expect } from 'claude-code/testing'

import type { Ask, Ledger, Speech } from '../types'
import { buildView, liveSpeech, statusLine, HOLD_TEXT } from './view'

const LEDGER: Ledger = { writes: [], claims: [], turns: {} }
const FULL: Speech = { header: 'WATCH S161 -> S162', text: 'Focus: the witness mod.', full: true, until: null }

const base = {
  body: 'phi' as const,
  frameIndex: 0,
  ledger: LEDGER,
  asks: [] as Ask[],
  activity: { activeMs: 0, lastAt: null },
  now: 1_000,
  speech: null as Speech | null,
  hold: null,
  barnacles: [],
  working: false,
  rowsLanded: false,
  maxRows: 24,
  bodyColumns: 100,
}

test('quiet: the compact sprite and no speech box', () => {
  const v = buildView(base)
  expect(v.size).toEqual('compact')
  expect(v.sprite.length).toEqual(5)
  expect(v.speech).toEqual([])
  expect(v.status).toEqual('asks 0/0')
})

// The band colours the eyes when the repo is metered (S165), so it must know where they
// are after the creature is turned to face its bubble.
test('the eye cells follow the creature when it is mirrored to face left', () => {
  const right = buildView(base)
  expect(right.eyes).toEqual([[2, 10]])
  const left = buildView({ ...base, facing: 'left' })
  expect(left.eyes).toEqual([[2, 3]])
  for (const [r, c] of left.eyes) expect(Array.from(left.sprite[r] ?? '')[c]).toEqual('o')
  const phial = buildView({ ...base, body: 'phial', facing: 'left' })
  expect(phial.eyes).toEqual([[2, 8], [2, 5]])
  for (const [r, c] of phial.eyes) expect(Array.from(phial.sprite[r] ?? '')[c]).toEqual('o')
})

// The chime and the barnacles take their own inks (1.1), so the band must know their cells
// as drawn, turned with the creature the way the eyes are.
test('the chime and the barnacles report their cells as drawn, mirrored with the creature', () => {
  const one = [{ key: 'k', text: 't', spoken: false }]
  const right = buildView({ ...base, barnacles: one })
  expect(right.bells).toEqual([[1, 0], [2, 0], [3, 0]])
  expect(right.barnacles).toEqual([[1, 4]])
  const left = buildView({ ...base, facing: 'left', barnacles: [...one, { key: 'j', text: 't', spoken: false }] })
  expect(left.bells).toEqual([[1, 13], [2, 13], [3, 13]])
  for (const [r, c] of left.bells) expect('●○◐◑').toContain(Array.from(left.sprite[r] ?? '')[c]!)
  // Half an hour of active time: the bottom bell, on the tentacle row, shows a half turned with the creature.
  const half = buildView({ ...base, facing: 'left', activity: { activeMs: 30 * 60_000, lastAt: 900 } })
  expect(Array.from(half.sprite[3] ?? '')[13]).toEqual('◑')
  expect(Array.from(half.sprite[2] ?? '')[13]).toEqual('○')
  expect(Array.from(half.sprite[4] ?? '')[13]).toEqual(' ')
  expect(left.barnacles).toEqual([[1, 9], [1, 5]])
  for (const [r, c] of left.barnacles) expect(Array.from(left.sprite[r] ?? '')[c]).toEqual('*')
  expect(buildView(base).barnacles).toEqual([])
})

test('a costume dresses the compact Phi, none undresses it, and Phial wears nothing (1.1)', () => {
  const bare = buildView({ ...base, facing: 'left' })
  const razor = buildView({ ...base, facing: 'left', costume: 'razor' })
  expect(razor.sprite[3]!.startsWith('\\==')).toBe(true)
  expect(razor.sprite.filter((r, i) => r !== bare.sprite[i]).length).toEqual(1)
  for (const row of razor.sprite) expect(Array.from(row).length).toEqual(14)
  const horns = buildView({ ...base, facing: 'left', costume: 'horns' })
  expect(horns.sprite[0]).toContain('6')
  expect(horns.sprite[0]).not.toContain('9')
  const compass = buildView({ ...base, facing: 'left', costume: 'compass' })
  expect(compass.sprite[3]).toContain('(<+)')
  expect(compass.eyes).toEqual(bare.eyes)
  // The costume's cells as drawn, so the band can ink them red: the razor's three cells at the row's left edge.
  expect([...razor.costume].sort((a, b) => a[1] - b[1])).toEqual([[3, 0], [3, 1], [3, 2]])
  for (const [r, c] of razor.costume) expect('\\=').toContain(Array.from(razor.sprite[r] ?? '')[c]!)
  expect(bare.costume).toEqual([])
  expect(buildView({ ...base, costume: 'razor' }).costume.map(([, c]) => c).sort()).toEqual([11, 12, 13])
  expect(buildView({ ...base, facing: 'left', costume: 'none' }).sprite).toEqual(bare.sprite)
  const phial = buildView({ ...base, body: 'phial', facing: 'left' })
  expect(buildView({ ...base, body: 'phial', facing: 'left', costume: 'razor' }).sprite).toEqual(phial.sprite)
})

test('a full moment shows the full sprite when the band has room', () => {
  const v = buildView({ ...base, speech: FULL, maxRows: 12, bodyColumns: 70 })
  expect(v.size).toEqual('full')
  expect(v.sprite.length).toEqual(9)
  expect(v.speech.length).toBeGreaterThan(0)
  expect(v.speech.length).toBeLessThan(9)
})

test('the compact fallback below the row threshold and below the column threshold', () => {
  const rows = buildView({ ...base, speech: FULL, maxRows: 11, bodyColumns: 120 })
  expect(rows.size).toEqual('compact')
  expect(rows.sprite.length).toEqual(5)
  expect(rows.speech.length).toBeLessThan(5)
  const cols = buildView({ ...base, speech: FULL, maxRows: 40, bodyColumns: 69 })
  expect(cols.size).toEqual('compact')
})

test('a held write turns on the safelight and speaks HELD over any other speech', () => {
  const hold = { toolUseId: 't', sql: 'UPDATE t SET a=1', fixed: null, at: 1 }
  const v = buildView({ ...base, speech: FULL, hold })
  expect(v.safelight).toBe(true)
  expect(v.speech[0]).toContain('HELD')
  expect(v.status).toContain('HELD')
  expect(liveSpeech(FULL, hold, 0)?.text).toEqual(HOLD_TEXT)
})

test('an expired speech is gone', () => {
  expect(liveSpeech({ ...FULL, until: 500 }, null, 1_000)).toBeNull()
  expect(liveSpeech({ ...FULL, until: 1_500 }, null, 1_000)).not.toBeNull()
})

test('the status line counts witnessed claims and shows a pale ask', () => {
  const ledger: Ledger = {
    writes: [],
    turns: {},
    claims: [
      { id: 'c1', turnId: 't1', text: 'Done.', at: 1, writeIds: [], state: 'developed' },
      { id: 'c2', turnId: 't2', text: 'Fixed.', at: 2, writeIds: ['w'], state: 'pale' },
    ],
  }
  const asks: Ask[] = [
    { id: 'a1', text: 'one', source: 'ask', state: 'witnessed', claimId: 'c1', at: 1 },
    { id: 'a2', text: 'two', source: 'ask', state: 'claimed', claimId: 'c2', at: 1 },
    { id: 'a3', text: 'three', source: 'goal', state: 'open', claimId: null, at: 1 },
  ]
  expect(statusLine(ledger, asks, null)).toEqual('asks 1/3 ~1 · witnessed 1/2')
})

test('statusLine shows carried asks as their own figure, never inside asks n/m', () => {
  const empty: Ledger = { writes: [], turns: {}, claims: [] }
  const carried: Ask[] = [
    { id: 'k1', text: 'old', source: 'carried', state: 'open', claimId: null, at: 1 },
    { id: 'k2', text: 'older', source: 'carried', state: 'witnessed', claimId: 'c', at: 1 },
  ]
  expect(statusLine(empty, carried, null)).toEqual('asks 0/0 · carried 1')
  expect(statusLine(empty, [{ ...carried[0]!, state: 'dropped' }], null)).toEqual('asks 0/0')
})

test('statusLine shows builds as their own figure, after carried', () => {
  const empty: Ledger = { writes: [], turns: {}, claims: [] }
  const asks: Ask[] = [
    { id: 'a', text: 'fix', source: 'ask', state: 'open', claimId: null, at: 1 },
    { id: 'k', text: 'old', source: 'carried', state: 'open', claimId: null, at: 1 },
    { id: 'b1', text: 'rebuild', source: 'build', state: 'open', claimId: null, at: 1 },
    { id: 'b2', text: 'apps', source: 'build', state: 'open', claimId: null, at: 1 },
  ]
  expect(statusLine(empty, asks, null)).toEqual('asks 0/1 · carried 1 · builds 2')
})

test('every sprite row keeps its exact width whatever the state', () => {
  for (const body of ['phi', 'phial'] as const) {
    for (const speech of [null, FULL]) {
      const v = buildView({ ...base, body, speech, barnacles: [{ key: 'k', text: 't', spoken: false }] })
      const width = v.size === 'full' ? 28 : 14
      for (const row of v.sprite) expect(row.length).toEqual(width)
    }
  }
})
