import { test, expect } from 'claude-code/testing'
import { FRAMES, frame, withBarnacles, withBells, withMood } from './sprites'
import type { Body, Mood, Size } from '../types'

const BODIES: Body[] = ['phi', 'phial']
const SIZES: Size[] = ['full', 'compact']
const WIDTH: Record<Size, number> = { full: 28, compact: 12 }
const HEIGHT: Record<Size, number> = { full: 9, compact: 5 }

function diffs(a: string[], b: string[]): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = []
  a.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== b[r]![c]!) out.push([r, c, row[c]!, b[r]![c]!])
  })
  return out
}

test('every frame of every body and size has exact rows and width', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      expect(FRAMES[body][size].length).toEqual(3)
      for (const f of FRAMES[body][size]) {
        expect(f.length).toEqual(HEIGHT[size])
        for (const row of f) expect(row.length).toEqual(WIDTH[size])
      }
    }
  }
})

test('frame() wraps the index modulo three', () => {
  expect(frame('phi', 'full', 3)).toEqual(FRAMES.phi.full[0])
  expect(frame('phial', 'compact', 5)).toEqual(FRAMES.phial.compact[2])
  expect(frame('phi', 'compact', -1)).toEqual(FRAMES.phi.compact[2])
})

test('sprites carry the source glyphs', () => {
  expect(FRAMES.phi.compact[0]![4]!).toContain('●●○○')
  expect(FRAMES.phial.full[0]![5]!).toContain('‿‿')
  expect(FRAMES.phi.compact[0]![2]!).toContain('o>')
  expect(FRAMES.phi.compact[0]![3]!).toContain('`')
})

const EYE_CELLS: Record<string, Array<[number, number]>> = {
  'phi/full': [[3, 19]],
  'phi/compact': [[2, 8]],
  'phial/full': [[4, 5], [4, 8]],
  'phial/compact': [[2, 3], [2, 6]],
}
const GLYPH: Record<Mood, string> = { calm: 'o', resting: '-', alert: 'O', shielding: '>', doubtful: '.', proud: '^' }

test('withMood sets exactly the eye cells for each mood, every body, size and frame', () => {
  const moods = Object.keys(GLYPH) as Mood[]
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        for (const mood of moods) {
          const out = withMood(rows, body, size, mood)
          expect(out.length).toEqual(rows.length)
          out.forEach((r, k) => expect(r.length).toEqual(rows[k]!.length))
          const cells = EYE_CELLS[body + '/' + size]!
          cells.forEach(([r, c], n) => {
            const want = mood === 'shielding' && body === 'phial' ? (n === 0 ? '>' : '<') : GLYPH[mood]
            expect(out[r]![c]).toEqual(want)
          })
          const changed = diffs(rows, out).filter(([r, c]) => !cells.some(([a, b]) => a === r && b === c))
          expect(changed).toEqual([])
        }
      }
    }
  }
})

test('named eye cells: Phi compact and Phial full', () => {
  const phi = withMood(frame('phi', 'compact', 0), 'phi', 'compact', 'alert')
  expect(phi[2]![8]).toEqual('O')
  const phial = withMood(frame('phial', 'full', 0), 'phial', 'full', 'proud')
  expect(phial[4]![5]).toEqual('^')
  expect(phial[4]![8]).toEqual('^')
  const shut = withMood(frame('phial', 'full', 0), 'phial', 'full', 'shielding')
  expect(shut[4]![5]! + shut[4]![8]!).toEqual('><')
})

test('withMood does not mutate its argument and survives a chain', () => {
  const rows = frame('phial', 'full', 1)
  const copy = rows.slice()
  withMood(rows, 'phial', 'full', 'alert')
  expect(rows).toEqual(copy)
  const chained = withBells(withMood(rows, 'phial', 'full', 'doubtful'), 'phial', 'full', 2)
  expect(chained[4]![5]).toEqual('.')
  expect(chained[7]).toContain('● ●')
})

test('withBells fills the first N chambers and changes only chamber cells', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        for (let n = 0; n <= 4; n++) {
          const out = withBells(rows, body, size, n)
          out.forEach((r, k) => expect(r.length).toEqual(rows[k]!.length))
          const text = out.join('')
          expect((text.match(/●/g) ?? []).length).toEqual(n)
          expect((text.match(/○/g) ?? []).length).toEqual(4 - n)
          for (const [, , from, to] of diffs(rows, out)) {
            expect('●○').toContain(from)
            expect('●○').toContain(to)
          }
        }
      }
    }
  }
})

test('withBells clamps out-of-range counts', () => {
  const rows = frame('phi', 'compact', 0)
  expect(withBells(rows, 'phi', 'compact', 9).join('').match(/●/g)?.length).toEqual(4)
  expect(withBells(rows, 'phi', 'compact', -3).join('').match(/●/g)).toBeNull()
})

test('withBarnacles adds only * on cells that were spaces, at least four available', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        for (let n = 0; n <= 4; n++) {
          const out = withBarnacles(rows, body, size, n)
          out.forEach((r, k) => expect(r.length).toEqual(rows[k]!.length))
          const d = diffs(rows, out)
          expect(d.length).toEqual(n)
          for (const [, , from, to] of d) {
            expect(from).toEqual(' ')
            expect(to).toEqual('*')
          }
        }
        const many = withBarnacles(rows, body, size, 99)
        expect(diffs(rows, many).length).toBeGreaterThanOrEqual(4)
      }
    }
  }
})
