// The companion's frames and the costumes it can wear. Pure: rows in, rows out.
//
// 1.1 (2026-10-09, Bradley's rulings in ../FAMILY.md section 2): the four watch bells hang
// as a chime at the creature's back, the side away from its face, one per row from the
// second row down (his live look: "one rung down"), with one blank column from the shell.
// The band mirrors the art, so the back is the LEFT edge here and the right edge on screen.
// The sprite is 14 columns for the chime (the full-size 28-column sprite was removed in 1.3.9).
// Naut's shell top is low lines with an undertie wave (.__‿_., the
// wave keeping the three animation positions) and its rim overlines with the tie ⁀ under
// the wave, its mirror image, moving with it. Phial carries the same chime; its base is
// plain. The props are masks over Naut's compact frame, ported from the ammonite
// lab: razor \== and compass (<+) on the tentacle row, horn tips 6 and 6 on the shell's
// corners. Each mask is stored facing right like the art, so the compass is (+>) here and
// the horns 9 9: the band's mirror turns them. Preview outside Claude Code with
//   python scripts/sprite-preview.py [--mirror --band 80]
// which reads one frame per line, so every frame below stays on its own line.

import type { Body, Costume, Mood, Prop, Size } from '../types'

type Frames = string[][]
type Cell = [number, number]
type PerFrame = Cell[][]
type Table<T> = Record<Body, Record<Size, T>>

/**
 * Three animation frames per body: 5 rows x 14. The
 * props follow as one-frame compact masks (spaces except their glyphs), which is how the
 * preview tool tells a prop from a body.
 */
export const FRAMES: Table<Frames> & Record<Prop, { compact: Frames }> = {
  phi: {
    compact: [
      ['   .__‿_.     ', '○  / .-. \\    ', '○ | ( @ ) o>~ ', '○  \\ `-\' /~   ', '    ‾‾⁀‾‾     '],
      ['   .__‿_.     ', '○  / .-. \\    ', '○ | ( @ ) ->- ', '○  \\ `-\' /-   ', '    ‾‾⁀‾‾     '],
      ['   ._‿__.     ', '○  / .-. \\    ', '○ | ( @ ) o>≈ ', '○  \\ `-\' /≈   ', '    ‾⁀‾‾‾     '],
    ],
  },
  phial: {
    compact: [
      ['     |~~|     ', '○    |  |     ', '○  / o  o \\   ', '○ (  ~‿‿~  )  ', '   `------\'   '],
      ['     |~~|     ', '○    | o|     ', '○  / -  - \\   ', '○ (  ~‿‿~  )  ', '   `------\'   '],
      ['     |o~|     ', '○    |  |     ', '○  / o  o \\   ', '○ (  ~‿‿~  )  ', '   `------\'   '],
    ],
  },
  razor: {
    compact: [
      // Bradley, 2026-10-09: '\==' on screen, on the tentacle row ahead of the tentacle's tip.
      ['              ', '              ', '              ', '           ==/', '              '],
    ],
  },
  compass: {
    compact: [
      // '(<+)' on screen, its closing bracket taking the tentacle's tip (GRIP) so Naut holds it.
      ['              ', '              ', '              ', '          (+>)', '              '],
    ],
  },
  horns: {
    compact: [
      // The tips read 6 and 6 on screen; the band's mirror turns a 9 into a 6.
      ['   9    9     ', '              ', '              ', '              ', '              '],
    ],
  },
  devil: {
    compact: [
      // The horns /(_‿__)\ over the shell top (1.3): the two corner dots and the blank cell
      // outside each. Stored facing right; the band's mirror turns it. Worn by Naut for one
      // draw while a guest drawing stands narrow above the band, never by /wear's atom alone.
      ['  /(    )\\    ', '              ', '              ', '              ', '              '],
    ],
  },
}

/** Eye cells per frame ([row, col]); Naut has one, Phial two (left then right). */
const EYES: Table<PerFrame> = {
  phi: {
    compact: [[[2, 10]], [[2, 10]], [[2, 10]]],
  },
  phial: {
    compact: [[[2, 5], [2, 8]], [[2, 5], [2, 8]], [[2, 5], [2, 8]]],
  },
}

/**
 * The chime: three bell cells per frame, top to bottom, down the creature's back, the
 * bottom bell on the tentacle row above the rim (Bradley, 2026-10-09: an hour a bell,
 * filling from the bottom, and the bells start on the tentacle row, not the rim).
 */
const BELLS: Table<PerFrame> = {
  phi: {
    compact: [[[1, 0], [2, 0], [3, 0]], [[1, 0], [2, 0], [3, 0]], [[1, 0], [2, 0], [3, 0]]],
  },
  phial: {
    compact: [[[1, 0], [2, 0], [3, 0]], [[1, 0], [2, 0], [3, 0]], [[1, 0], [2, 0], [3, 0]]],
  },
}

/** Interior cells that are spaces in all three frames, in fill order. */
const BARNACLES: Table<Cell[]> = {
  phi: {
    compact: [[1, 4], [1, 8], [3, 4], [3, 8]],
  },
  phial: {
    compact: [[3, 3], [3, 4], [3, 9], [3, 10]],
  },
}

/** The three extents of the safelight blush (1.7): the rim, then the shell's walls, then its top. */
export type BlushPart = 'rim' | 'walls' | 'top'

/**
 * The shell cells the blush may redden, per body, as drawn (facing right). Read off the frames:
 * the same non-space glyphs in all three, none a barnacle or gem cell, a bell or an eye, and
 * never the coil. Naut: the rim under the wave, the side strokes `/ \ | \ /`, the top `.__‿_.`.
 */
const BLUSH: Table<Record<BlushPart, Cell[]>> = {
  phi: {
    compact: {
      rim: [[4, 4], [4, 5], [4, 6], [4, 7], [4, 8]],
      walls: [[1, 3], [1, 9], [2, 2], [3, 3], [3, 9]],
      top: [[0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8]],
    },
  },
  phial: {
    compact: {
      rim: [[4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9], [4, 10]],
      walls: [[1, 5], [1, 8], [2, 3], [2, 10], [3, 2], [3, 11]],
      top: [[0, 5], [0, 6], [0, 7], [0, 8]],
    },
  },
}

/** The parts of the shell a rung reddens: 1 the rim, 2 the rim and walls, 3 the rim, walls and top. */
export const BLUSH_PARTS: Readonly<Record<1 | 2 | 3, readonly BlushPart[]>> = {
  1: ['rim'],
  2: ['rim', 'walls'],
  3: ['rim', 'walls', 'top'],
}

/** The cells a rung reddens, as drawn (facing right); a rung outside 1 to 3 reddens nothing. */
export function blushCellsOf(body: Body, size: Size, rung: number): Cell[] {
  const parts = BLUSH_PARTS[rung as 1 | 2 | 3] ?? []
  return parts.flatMap((p) => copyCells(BLUSH[body][size][p]))
}

/**
 * The tentacle tip a held prop may take: the compass's bracket sits here so Naut grips it.
 * The only tentacle cell any prop replaces.
 */
export const GRIP: Cell = [3, 10]

/** The shell's two top corners, which the horns (and the devil, with the blank beside each) replace. */
export const CORNERS: Cell[] = [[0, 3], [0, 8]]

const FILLED = '●'
const EMPTY = '○'
/** Half a bell: thirty minutes. Mirrored to the right-half glyph by the band. */
const HALF = '◐'

const EYE_GLYPH: Record<Mood, string> = {
  calm: 'o',
  resting: '-',
  alert: 'O',
  shielding: '>',
  doubtful: '.',
  proud: '^',
}

export function frame(body: Body, size: Size, index: number): string[] {
  const frames = FRAMES[body][size]
  const i = ((Math.trunc(index) % frames.length) + frames.length) % frames.length
  return frames[i] ?? []
}

function diffCount(a: string[], b: string[]): number {
  let n = 0
  a.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== (b[r] ?? '')[c]) n++
  })
  return n
}

/** Which frame these rows are: the nearest by cell difference, so edited rows still resolve. */
function frameIndexOf(rows: string[], body: Body, size: Size): number {
  const diffs = FRAMES[body][size].map((f) => diffCount(f, rows))
  return diffs.indexOf(Math.min(...diffs))
}

function put(rows: string[], cells: Cell[], glyphs: string[]): string[] {
  const out = rows.slice()
  cells.forEach(([r, c], k) => {
    const row = out[r] ?? ''
    out[r] = row.slice(0, c) + glyphs[k] + row.slice(c + 1)
  })
  return out
}

const copyCells = (cells: Cell[]): Cell[] => cells.map(([r, c]) => [r, c] as Cell)

function eyeGlyphs(body: Body, mood: Mood, n: number): string[] {
  if (mood === 'shielding' && body === 'phial') return ['>', '<']
  return Array.from({ length: n }, () => EYE_GLYPH[mood])
}

/** Where the eyes are in these rows, as drawn (facing right): [row, column] per eye. */
export function eyeCellsOf(rows: string[], body: Body, size: Size): Cell[] {
  return copyCells(EYES[body][size][frameIndexOf(rows, body, size)] ?? [])
}

/** The chime's three bell cells in these rows, top to bottom, as drawn (facing right). */
export function bellCellsOf(rows: string[], body: Body, size: Size): Cell[] {
  return copyCells(BELLS[body][size][frameIndexOf(rows, body, size)] ?? [])
}

/** The cells the first `count` barnacles occupy, as drawn (facing right). */
export function barnacleCellsOf(body: Body, size: Size, count: number): Cell[] {
  const all = BARNACLES[body][size]
  const n = Math.max(0, Math.min(all.length, Math.trunc(count)))
  return copyCells(all.slice(0, n))
}

export function withMood(rows: string[], body: Body, size: Size, mood: Mood): string[] {
  const cells = EYES[body][size][frameIndexOf(rows, body, size)] ?? []
  return put(rows, cells, eyeGlyphs(body, mood, cells.length))
}

/**
 * The chime filled to `halves` half-bells from the bottom (1.1): the lowest bell takes the
 * first two halves, then the one above it. A half is ◐, a whole ●, an empty bell ○.
 */
export function withBells(rows: string[], body: Body, size: Size, halves: number): string[] {
  const cells = BELLS[body][size][frameIndexOf(rows, body, size)] ?? []
  const n = Math.max(0, Math.min(2 * cells.length, Math.trunc(halves)))
  const glyphs = cells.map((_, k) => {
    const fromBottom = cells.length - 1 - k
    const fill = Math.max(0, Math.min(2, n - 2 * fromBottom))
    return fill === 2 ? FILLED : fill === 1 ? HALF : EMPTY
  })
  return put(rows, cells, glyphs)
}

export function withBarnacles(rows: string[], body: Body, size: Size, count: number): string[] {
  const cells = barnacleCellsOf(body, size, count)
  return put(rows, cells, cells.map(() => '*'))
}

/** What waits on the shell: barnacles, and the hook and skill candidates not yet settled. */
export type DecorCounts = { barnacles: number; hooks: number; skills: number }

/** The cells each kind of decoration got, as drawn (facing right). */
export type Decor = { barnacles: Cell[]; hooks: Cell[]; skills: Cell[] }

/** The gem: a bright faceted diamond, symmetric, so the band's mirror leaves it alone. */
export const GEM = '◈'

const wholeCount = (n: number): number => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))

/**
 * How the shell's four decoration cells are shared (1.5, Bradley 2026-10-11): barnacles and the
 * candidate gems use the same cells. Every kind present first gets one cell (three kinds at most,
 * so it always fits); the cells left go to barnacles, then hooks, then skills, each up to its own
 * count. With no candidates this is exactly the barnacles' own fill.
 */
export function shareCells(room: number, want: DecorCounts): DecorCounts {
  const n = { barnacles: wholeCount(want.barnacles), hooks: wholeCount(want.hooks), skills: wholeCount(want.skills) }
  const got = { barnacles: Math.min(1, n.barnacles), hooks: Math.min(1, n.hooks), skills: Math.min(1, n.skills) }
  let left = Math.max(0, room - got.barnacles - got.hooks - got.skills)
  for (const kind of ['barnacles', 'hooks', 'skills'] as const) {
    const more = Math.min(left, n[kind] - got[kind])
    got[kind] += more
    left -= more
  }
  return got
}

/**
 * The cells the shell's decorations occupy, per kind, taken from the barnacles' fill order:
 * barnacles first, then the hook gems, then the skill gems.
 */
export function shellDecor(body: Body, size: Size, want: DecorCounts): Decor {
  const all = BARNACLES[body][size]
  const got = shareCells(all.length, want)
  return {
    barnacles: copyCells(all.slice(0, got.barnacles)),
    hooks: copyCells(all.slice(got.barnacles, got.barnacles + got.hooks)),
    skills: copyCells(all.slice(got.barnacles + got.hooks, got.barnacles + got.hooks + got.skills)),
  }
}

/** The shell with its decorations drawn: `*` for a barnacle, the gem for a hook or skill candidate. */
export function withDecor(rows: string[], decor: Decor): string[] {
  const cells = [...decor.barnacles, ...decor.hooks, ...decor.skills]
  const glyphs = [...decor.barnacles.map(() => '*'), ...decor.hooks.map(() => GEM), ...decor.skills.map(() => GEM)]
  return put(rows, cells, glyphs)
}

export const PROPS: readonly Prop[] = ['razor', 'compass', 'horns', 'devil']

/** The word after /wear: a prop, `none` (or `off`) to undress, null for anything else or nothing. */
export function parseCostume(args: unknown): Costume | null {
  const word = (typeof args === 'string' ? args : '').trim().toLowerCase()
  if (word === 'none' || word === 'off') return 'none'
  return PROPS.find((p) => p === word) ?? null
}

/** A prop's cells: every non-space cell of its mask, with the glyph it draws. */
export function propCells(prop: Prop): Array<[number, number, string]> {
  const mask = FRAMES[prop].compact[0] ?? []
  const out: Array<[number, number, string]> = []
  mask.forEach((row, r) => {
    Array.from(row).forEach((ch, c) => {
      if (ch !== ' ') out.push([r, c, ch])
    })
  })
  return out
}

/**
 * Naut's compact rows with the prop drawn over them; a new list, the input untouched. A
 * prop is a costume on Naut only (one companion, one identity, the role shown by what it
 * holds): on Phial the rows come back unchanged.
 */
export function withProp(rows: string[], body: Body, size: Size, prop: Prop): string[] {
  if (body !== 'phi' || size !== 'compact') return rows.slice()
  const out = rows.slice()
  for (const [r, c, glyph] of propCells(prop)) {
    const chars = Array.from(out[r] ?? '')
    if (c >= chars.length) continue
    chars[c] = glyph
    out[r] = chars.join('')
  }
  return out
}
