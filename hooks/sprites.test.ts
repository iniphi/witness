import { test, expect } from 'claude-code/testing'
import {
  CORNERS,
  FRAMES,
  GRIP,
  PROPS,
  barnacleCellsOf,
  bellCellsOf,
  eyeCellsOf,
  frame,
  parseCostume,
  propCells,
  withBarnacles,
  withBells,
  withMood,
  withProp,
} from './sprites'
import type { Body, Mood, Size } from '../types'

const BODIES: Body[] = ['phi', 'phial']
const SIZES: Size[] = ['full', 'compact']
const WIDTH: Record<Size, number> = { full: 28, compact: 14 }
const HEIGHT: Record<Size, number> = { full: 9, compact: 5 }

const cells = (rows: string[]): string[][] => rows.map((r) => Array.from(r))

function diffs(a: string[], b: string[]): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = []
  cells(a).forEach((row, r) => {
    const other = Array.from(b[r] ?? '')
    row.forEach((ch, c) => {
      if (ch !== other[c]) out.push([r, c, ch, other[c] ?? ''])
    })
  })
  return out
}

test('every frame of every body and size has exact rows and width', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      expect(FRAMES[body][size].length).toEqual(3)
      for (const f of FRAMES[body][size]) {
        expect(f.length).toEqual(HEIGHT[size])
        for (const row of f) expect(Array.from(row).length).toEqual(WIDTH[size])
      }
    }
  }
})

test('every prop is a one-frame compact mask of the compact width', () => {
  for (const prop of PROPS) {
    expect(FRAMES[prop].compact.length).toEqual(1)
    const mask = FRAMES[prop].compact[0]!
    expect(mask.length).toEqual(HEIGHT.compact)
    for (const row of mask) expect(Array.from(row).length).toEqual(WIDTH.compact)
    expect(propCells(prop).length).toBeGreaterThan(0)
  }
})

test('frame() wraps the index modulo three', () => {
  expect(frame('phi', 'full', 3)).toEqual(FRAMES.phi.full[0])
  expect(frame('phial', 'compact', 5)).toEqual(FRAMES.phial.compact[2])
  expect(frame('phi', 'compact', -1)).toEqual(FRAMES.phi.compact[2])
})

test('sprites carry the ruled glyphs: the chime from the second row, the undertie wave, the rim with its tie', () => {
  const phi = FRAMES.phi.compact[0]!
  expect(phi[0]!.startsWith(' ')).toBe(true)
  expect(phi[1]!.startsWith('○')).toBe(true)
  expect(phi[3]!.startsWith('○')).toBe(true)
  expect(phi[4]!.startsWith(' ')).toBe(true)
  expect(phi[0]).toContain('.__‿_.')
  expect(FRAMES.phi.compact[2]![0]).toContain('._‿__.')
  expect(phi[4]).toContain('‾‾⁀‾‾')
  expect(FRAMES.phi.compact[2]![4]).toContain('‾⁀‾‾‾')
  expect(phi[2]).toContain('o>')
  expect(FRAMES.phi.full[0]![1]).toContain('.__‿_.')
  expect(FRAMES.phi.full[0]![7]).toContain('‾‾‾‾⁀‾‾‾')
  expect(FRAMES.phi.full[2]![7]).toContain('‾‾‾⁀‾‾‾‾')
  expect(FRAMES.phial.full[0]![5]).toContain('‿‿')
  expect(FRAMES.phial.compact[0]![4]).toContain('`------\'')
})

// The tie sits under the wave, its mirror image, and moves with it (Bradley's sketch, 2026-10-09).
test('the rim tie sits under the top wave in every compact Phi frame', () => {
  for (const f of FRAMES.phi.compact) {
    const wave = Array.from(f[0]!).indexOf('‿')
    const tie = Array.from(f[4]!).indexOf('⁀')
    expect(wave).toBeGreaterThan(0)
    expect(tie).toEqual(wave)
  }
  for (const f of FRAMES.phi.full) {
    expect(Array.from(f[7]!).indexOf('⁀')).toEqual(Array.from(f[1]!).indexOf('‿'))
  }
})

test('the chime stands at the back: three bells on consecutive rows, a blank column before the shell', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        const bells = bellCellsOf(rows, body, size)
        expect(bells.length).toEqual(3)
        bells.forEach(([r, c], k) => {
          expect(c).toEqual(0)
          if (k > 0) expect(r).toEqual(bells[k - 1]![0] + 1)
          expect('●○◐').toContain(Array.from(rows[r]!)[0]!)
          expect(Array.from(rows[r]!)[1]).toEqual(' ')
        })
        // The compact chime's bottom bell is on the tentacle row, above the rim (Bradley, 2026-10-09);
        // nothing else in column 0 is a bell glyph.
        if (size === 'compact') expect(bells[2]![0]).toEqual(rows.length - 2)
        rows.forEach((row, r) => {
          if (!bells.some(([br]) => br === r)) expect(Array.from(row)[0]).toEqual(' ')
        })
      }
    }
  }
})

const EYE_CELLS: Record<string, Array<[number, number]>> = {
  'phi/full': [[3, 21]],
  'phi/compact': [[2, 10]],
  'phial/full': [[4, 7], [4, 10]],
  'phial/compact': [[2, 5], [2, 8]],
}
const GLYPH: Record<Mood, string> = { calm: 'o', resting: '-', alert: 'O', shielding: '>', doubtful: '.', proud: '^' }

test('withMood sets exactly the eye cells for each mood, every body, size and frame', () => {
  const moods = Object.keys(GLYPH) as Mood[]
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        expect(eyeCellsOf(rows, body, size)).toEqual(EYE_CELLS[body + '/' + size])
        for (const mood of moods) {
          const out = withMood(rows, body, size, mood)
          expect(out.length).toEqual(rows.length)
          out.forEach((r, k) => expect(Array.from(r).length).toEqual(Array.from(rows[k]!).length))
          const want = EYE_CELLS[body + '/' + size]!
          want.forEach(([r, c], n) => {
            const glyph = mood === 'shielding' && body === 'phial' ? (n === 0 ? '>' : '<') : GLYPH[mood]
            expect(Array.from(out[r]!)[c]).toEqual(glyph)
          })
          const changed = diffs(rows, out).filter(([r, c]) => !want.some(([a, b]) => a === r && b === c))
          expect(changed).toEqual([])
        }
      }
    }
  }
})

test('named eye cells: Phi compact and Phial full', () => {
  const phi = withMood(frame('phi', 'compact', 0), 'phi', 'compact', 'alert')
  expect(Array.from(phi[2]!)[10]).toEqual('O')
  const phial = withMood(frame('phial', 'full', 0), 'phial', 'full', 'proud')
  expect(Array.from(phial[4]!)[7]).toEqual('^')
  expect(Array.from(phial[4]!)[10]).toEqual('^')
  const shut = withMood(frame('phial', 'full', 0), 'phial', 'full', 'shielding')
  expect(Array.from(shut[4]!)[7]! + Array.from(shut[4]!)[10]!).toEqual('><')
})

test('withMood does not mutate its argument and survives a chain', () => {
  const rows = frame('phial', 'full', 1)
  const copy = rows.slice()
  withMood(rows, 'phial', 'full', 'alert')
  expect(rows).toEqual(copy)
  const chained = withBells(withMood(rows, 'phial', 'full', 'doubtful'), 'phial', 'full', 2)
  expect(Array.from(chained[4]!)[7]).toEqual('.')
  expect(chained.map((r) => Array.from(r)[0]).join('')).toEqual('  ○○●    ')
})

// Bradley's sketch (2026-10-09): three bells of an hour each, filling from the bottom, a
// half for thirty minutes. Top to bottom, six half-bells read ○○◐, ○●◐ ... ●●●.
const CHIME: Record<number, string> = { 0: '○○○', 1: '○○◐', 2: '○○●', 3: '○◐●', 4: '○●●', 5: '◐●●', 6: '●●●' }

test('withBells fills the chime from the bottom, a half for an odd count, and changes only bell cells', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        for (let h = 0; h <= 6; h++) {
          const out = withBells(rows, body, size, h)
          out.forEach((r, k) => expect(Array.from(r).length).toEqual(Array.from(rows[k]!).length))
          const column = bellCellsOf(rows, body, size).map(([r]) => Array.from(out[r]!)[0])
          expect(column.join('')).toEqual(CHIME[h])
          const text = out.join('')
          expect((text.match(/●/g) ?? []).length).toEqual(Math.floor(h / 2))
          expect((text.match(/◐/g) ?? []).length).toEqual(h % 2)
          for (const [, , from, to] of diffs(rows, out)) {
            expect('●○◐').toContain(from)
            expect('●○◐').toContain(to)
          }
        }
      }
    }
  }
})

test('withBells clamps out-of-range counts', () => {
  const rows = frame('phi', 'compact', 0)
  expect(withBells(rows, 'phi', 'compact', 9).join('').match(/●/g)?.length).toEqual(3)
  expect(withBells(rows, 'phi', 'compact', 7).join('').match(/◐/g)).toBeNull()
  expect(withBells(rows, 'phi', 'compact', -3).join('').match(/[●◐]/g)).toBeNull()
})

test('withBarnacles adds only * on cells that were spaces, at least four available, where the cell table says', () => {
  for (const body of BODIES) {
    for (const size of SIZES) {
      for (let i = 0; i < 3; i++) {
        const rows = frame(body, size, i)
        for (let n = 0; n <= 4; n++) {
          const out = withBarnacles(rows, body, size, n)
          out.forEach((r, k) => expect(Array.from(r).length).toEqual(Array.from(rows[k]!).length))
          const d = diffs(rows, out)
          expect(d.length).toEqual(n)
          for (const [, , from, to] of d) {
            expect(from).toEqual(' ')
            expect(to).toEqual('*')
          }
          const where = barnacleCellsOf(body, size, n)
          expect(where.length).toEqual(n)
          for (const [r, c] of where) expect(Array.from(out[r]!)[c]).toEqual('*')
        }
        const many = withBarnacles(rows, body, size, 99)
        expect(diffs(rows, many).length).toBeGreaterThanOrEqual(4)
      }
    }
  }
})

// Derived from the frames themselves, never from a copied cell list (the to-do's trap: a
// width change moves every prop). Only the compass takes the tentacle tip, only the horns
// take the shell's corners; every other prop cell is a space in all three frames.
test('every prop cell lies on a free cell of every compact Phi frame, except GRIP and the corners', () => {
  const frames = FRAMES.phi.compact
  for (const prop of PROPS) {
    for (const [r, c] of propCells(prop)) {
      const under = frames.map((f) => Array.from(f[r]!)[c]!)
      const isGrip = r === GRIP[0] && c === GRIP[1]
      const isCorner = CORNERS.some(([a, b]) => a === r && b === c)
      if (prop === 'compass' && isGrip) for (const ch of under) expect('~-≈').toContain(ch)
      else if ((prop === 'horns' || prop === 'devil') && isCorner) expect(under).toEqual(['.', '.', '.'])
      else expect(under).toEqual([' ', ' ', ' '])
    }
  }
  expect(propCells('compass').some(([r, c]) => r === GRIP[0] && c === GRIP[1])).toBe(true)
  expect(propCells('horns').length).toEqual(2)
  expect(propCells('razor').every(([r]) => r === GRIP[0])).toBe(true)
})

test('withProp dresses the compact Phi only, keeps every width, and leaves its input untouched', () => {
  for (let i = 0; i < 3; i++) {
    const rows = frame('phi', 'compact', i)
    const copy = rows.slice()
    for (const prop of PROPS) {
      const out = withProp(rows, 'phi', 'compact', prop)
      expect(rows).toEqual(copy)
      out.forEach((r, k) => expect(Array.from(r).length).toEqual(Array.from(rows[k]!).length))
      const changed = diffs(rows, out)
      expect(changed.length).toEqual(propCells(prop).length)
      for (const [r, c, , to] of changed) expect(propCells(prop)).toContainEqual([r, c, to])
    }
    expect(withProp(frame('phial', 'compact', i), 'phial', 'compact', 'razor')).toEqual(frame('phial', 'compact', i))
    expect(withProp(frame('phi', 'full', i), 'phi', 'full', 'horns')).toEqual(frame('phi', 'full', i))
  }
  const dressed = withProp(frame('phi', 'compact', 0), 'phi', 'compact', 'compass')
  expect(dressed[3]).toContain('(+>)')
  expect(eyeCellsOf(dressed, 'phi', 'compact')).toEqual([[2, 10]])
})

test('the devil is the horns /( )\\ over the shell top: the two corners and the blank outside each', () => {
  expect(FRAMES.devil.compact[0]![0]).toEqual('  /(    )\\    ')
  expect(propCells('devil').map(([r, c]) => [r, c])).toEqual([[0, 2], [0, 3], [0, 8], [0, 9]])
  for (let i = 0; i < 3; i++) {
    const rows = frame('phi', 'compact', i)
    const out = withProp(rows, 'phi', 'compact', 'devil')
    expect(out[0]!.slice(2, 10)).toMatch(/^\/\(.{4}\)\\$/)
    expect(out[0]!.slice(4, 8)).toEqual(rows[0]!.slice(4, 8))
    expect(out.slice(1)).toEqual(rows.slice(1))
    expect(Array.from(out[0]!).length).toEqual(14)
  }
})

test('parseCostume reads the word after /wear', () => {
  expect(parseCostume('razor')).toEqual('razor')
  expect(parseCostume('  Compass ')).toEqual('compass')
  expect(parseCostume('horns')).toEqual('horns')
  expect(parseCostume('Devil')).toEqual('devil')
  expect(parseCostume('none')).toEqual('none')
  expect(parseCostume('off')).toEqual('none')
  expect(parseCostume('')).toBeNull()
  expect(parseCostume(undefined)).toBeNull()
  expect(parseCostume('hat')).toBeNull()
})
