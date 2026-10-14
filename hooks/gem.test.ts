import { test, expect } from 'claude-code/testing'

import type { Ask, Barnacle, Body, Candidate, Ledger } from '../types'
import { INKS } from './body'
import { settleCandidatesIn, takePrompt, unsettled } from './notes'
import { gemLine, rowInks } from './render'
import { GEM, frame, shareCells, shellDecor, withBarnacles, withDecor } from './sprites'
import { buildView, mirror } from './view'

// The gem (1.5, Bradley 2026-10-11): a hook or skill candidate waiting is a ◈ on the shell.

const BODIES: Body[] = ['phi', 'phial']
const LEDGER: Ledger = { writes: [], claims: [], turns: {} }
const base = {
  body: 'phi' as Body,
  frameIndex: 0,
  ledger: LEDGER,
  asks: [] as Ask[],
  activity: { activeMs: 0, lastAt: null },
  now: 1_000,
  speech: null,
  hold: null,
  barnacles: [] as Barnacle[],
  working: false,
  rowsLanded: false,
  maxRows: 24,
  bodyColumns: 100,
}
const barnacle = (key: string): Barnacle => ({ key, text: 't', spoken: false })
const barnacles = (n: number): Barnacle[] => Array.from({ length: n }, (_, i) => barnacle(`b${i}`))
const cand = (title: string, kind: Candidate['kind'], extra: Partial<Candidate> = {}): Candidate => ({
  key: `${kind}:${title}`, kind, title, why: 'w', evidence: 'e', at: 10, filed: false, ...extra,
})
const want = (b: number, h: number, k: number) => ({ barnacles: b, hooks: h, skills: k })
const sizes = (d: ReturnType<typeof shellDecor>) => [d.barnacles.length, d.hooks.length, d.skills.length]

test('shareCells: a kind present first gets one cell, then barnacles, hooks, skills fill the rest', () => {
  expect(shareCells(4, want(0, 0, 0))).toEqual(want(0, 0, 0))
  expect(shareCells(4, want(1, 1, 1))).toEqual(want(1, 1, 1))
  expect(shareCells(4, want(4, 1, 1))).toEqual(want(2, 1, 1))
  expect(shareCells(4, want(0, 2, 3))).toEqual(want(0, 2, 2))
  expect(shareCells(4, want(0, 0, 9))).toEqual(want(0, 0, 4))
  expect(shareCells(4, want(9, 0, 0))).toEqual(want(4, 0, 0))
  expect(shareCells(4, want(2, 5, 5))).toEqual(want(2, 1, 1))
  expect(shareCells(4, want(1, 5, 5))).toEqual(want(1, 2, 1))
  expect(shareCells(4, want(0, 1, 1))).toEqual(want(0, 1, 1))
  expect(shareCells(4, want(0, 1, 9))).toEqual(want(0, 1, 3))
  expect(shareCells(4, want(-2, Number.NaN, 1.9))).toEqual(want(0, 0, 1))
})

test('shellDecor with no candidates is today: the first n barnacle cells, on both bodies', () => {
  for (const body of BODIES) {
    for (let i = 0; i < 3; i++) {
      const rows = frame(body, 'compact', i)
      for (let n = 0; n <= 4; n++) {
        const d = shellDecor(body, 'compact', want(n, 0, 0))
        expect(withDecor(rows, d)).toEqual(withBarnacles(rows, body, 'compact', n))
        expect(d.hooks).toEqual([])
        expect(d.skills).toEqual([])
      }
      expect(withDecor(rows, shellDecor(body, 'compact', want(9, 0, 0)))).toEqual(withBarnacles(rows, body, 'compact', 99))
    }
  }
})

test('shellDecor hands out the cells in the barnacle fill order: barnacles, then hooks, then skills, never twice', () => {
  for (const body of BODIES) {
    const all = shellDecor(body, 'compact', want(4, 0, 0)).barnacles
    const d = shellDecor(body, 'compact', want(1, 2, 1))
    expect(sizes(d)).toEqual([1, 2, 1])
    expect([...d.barnacles, ...d.hooks, ...d.skills]).toEqual(all)
    expect(sizes(shellDecor(body, 'compact', want(4, 1, 1)))).toEqual([2, 1, 1])
    expect(sizes(shellDecor(body, 'compact', want(0, 2, 3)))).toEqual([0, 2, 2])
  }
})

test('every gem cell is blank in all three frames of both bodies, and a gem draws only the gem', () => {
  for (const body of BODIES) {
    for (let i = 0; i < 3; i++) {
      const rows = frame(body, 'compact', i)
      const d = shellDecor(body, 'compact', want(0, 2, 2))
      for (const [r, c] of [...d.hooks, ...d.skills]) expect(Array.from(rows[r] ?? '')[c]).toEqual(' ')
      const out = withDecor(rows, d)
      expect(out.join('').split(GEM).length - 1).toEqual(4)
      out.forEach((row, r) => expect(Array.from(row).length).toEqual(Array.from(rows[r] ?? '').length))
    }
  }
})

test('mirror keeps the gem as it is', () => {
  expect(mirror(['a◈b'])).toEqual(['b◈a'])
  expect(mirror([GEM])).toEqual([GEM])
})

test('the view reports the gems by kind, as drawn, and the barnacles the cells they actually got', () => {
  const cands = [cand('a', 'hook'), cand('b', 'skill'), cand('c', 'skill')]
  const v = buildView({ ...base, barnacles: barnacles(4), candidates: cands })
  expect([v.barnacles.length, v.hookGems.length, v.skillGems.length]).toEqual([2, 1, 1])
  for (const [r, c] of v.barnacles) expect(Array.from(v.sprite[r] ?? '')[c]).toEqual('*')
  for (const [r, c] of [...v.hookGems, ...v.skillGems]) expect(Array.from(v.sprite[r] ?? '')[c]).toEqual(GEM)
  const left = buildView({ ...base, facing: 'left', barnacles: barnacles(4), candidates: cands })
  expect(left.hookGems.length + left.skillGems.length).toEqual(2)
  for (const [r, c] of [...left.hookGems, ...left.skillGems]) expect(Array.from(left.sprite[r] ?? '')[c]).toEqual(GEM)
  for (const [r, c] of left.barnacles) expect(Array.from(left.sprite[r] ?? '')[c]).toEqual('*')
})

test('no candidates draws the shell exactly as before; a filed candidate is a gem, a settled one is not', () => {
  const none = buildView({ ...base, barnacles: barnacles(3) })
  expect(none.sprite).toEqual(buildView({ ...base, barnacles: barnacles(3), candidates: [] }).sprite)
  expect(none.hookGems).toEqual([])
  const filed = buildView({ ...base, candidates: [cand('f', 'hook', { filed: true })] })
  expect(filed.hookGems.length).toEqual(1)
  const settled = buildView({
    ...base,
    candidates: [cand('t', 'hook', { settled: { how: 'taken', at: 5 } }), cand('d', 'skill', { settled: { how: 'dismissed', at: 6 } })],
  })
  expect(settled.hookGems).toEqual([])
  expect(settled.skillGems).toEqual([])
  expect(settled.sprite.join('')).not.toContain(GEM)
})

test('rowInks inks the hook gem green and the skill gem blue, by theme key, never hex', () => {
  expect(INKS.hookGem).toEqual('success')
  expect(INKS.skillGem).toEqual('suggestion')
  const view: any = { bells: [], barnacles: [[1, 4]], hookGems: [[1, 8]], skillGems: [[3, 4]], eyes: [], costume: [], blush: [] }
  expect(rowInks(view, 1, false)).toEqual([{ col: 4, color: '#B59670' }, { col: 8, color: 'success' }])
  expect(rowInks(view, 3, false)).toEqual([{ col: 4, color: 'suggestion' }])
})

test('unsettled and settleCandidatesIn: filed is not settled; a settle merges by key and keeps the rest', () => {
  const list = [cand('a', 'hook', { filed: true }), cand('b', 'skill'), cand('c', 'hook', { settled: { how: 'taken', at: 1 } })]
  expect(unsettled(list).map(c => c.key)).toEqual(['hook:a', 'skill:b'])
  const next = settleCandidatesIn(list, ['skill:b', 'hook:c'], 'dismissed', 99)
  expect(next[1]?.settled).toEqual({ how: 'dismissed', at: 99 })
  expect(next[2]?.settled).toEqual({ how: 'taken', at: 1 })
  expect(next[0]?.settled).toBeUndefined()
  expect(list[1]?.settled).toBeUndefined()
})

test('takePrompt and gemLine word a candidate as the ruling asks', () => {
  const c = cand('Guard bare UPDATE', 'hook', { why: 'it recurs', evidence: 'three holds' })
  expect(takePrompt(c)).toEqual(
    'A witness hook candidate: Guard bare UPDATE. Why: it recurs. Evidence: three holds. Propose how to build it as a hook, or say why it should not be built.',
  )
  expect(gemLine(c)).toEqual('◈ [hook] Guard bare UPDATE - it recurs')
})
