import type { Body, Mood, Size } from '../types'

type Frames = string[][]
type Cell = [number, number]
type PerFrame = Cell[][]
type Table<T> = Record<Body, Record<Size, T>>

/** Three animation frames per body and size; full 9 rows x 28, compact 5 rows x 12. */
export const FRAMES: Record<Body, Record<Size, Frames>> = {
  phi: {
    full: [
      ['    .-\'\'\'\'\'\'-.              ', '  .\'  .-\'\'-.  \'.            ', ' /  .\' .-. \'.  \\            ', '|  /  ( @ )  \\  |/\'o\\       ', '|  \\   \'-\'   /  |\\__/~~~    ', ' \\  \'-.__.-\'   /)))~~~~     ', '  \'.  ● ● ○ ○ .\'))~~~ ~     ', '    \'-......-\'  ~ ~~ ~      ', '                 ~  ~       '],
      ['    .-\'\'\'\'\'\'-.              ', '  .\'  .-\'\'-.  \'.            ', ' /  .\' .-. \'.  \\            ', '|  /  ( @ )  \\  |/\'-\\       ', '|  \\   \'-\'   /  |\\__/-~~    ', ' \\  \'-.__.-\'   /)))-~~~     ', '  \'.  ● ● ○ ○ .\'))~~~ ~     ', '    \'-......-\'   ~ ~~ ~     ', '                 ~  ~       '],
      ['    .-\'\'\'\'\'\'-.              ', '  .\'  .-\'\'-.  \'.            ', ' /  .\' .-. \'.  \\            ', '|  /  ( @ )  \\  |/\'o\\       ', '|  \\   \'-\'   /  |\\__/≈≈~    ', ' \\  \'-.__.-\'   /)))≈~~~     ', '  \'.  ● ● ○ ○ .\'))~~~ ~     ', '    \'-......-\'  ~ ~~ ~      ', '                ~  ~ ~      '],
    ],
    compact: [
      [' .--~-.     ', ' / .-. \\    ', '| ( @ ) o>~ ', ' \\ `-\' /~   ', '  `●●○○\'    '],
      [' .--~-.     ', ' / .-. \\    ', '| ( @ ) ->- ', ' \\ `-\' /-   ', '  `●●○○\'    '],
      [' .-~--.     ', ' / .-. \\    ', '| ( @ ) o>≈ ', ' \\ `-\' /≈   ', '  `●●○○\'    '],
    ],
  },
  phial: {
    full: [
      ['    |~~~~|      o           ', '    |    |    o             ', '    |    |   .              ', '   /      \\                 ', ' /   o  o   \\               ', '|     ‿‿     |              ', '|~~~~~~~~~~~~|              ', ' \\ ● ●  ○ ○ /               ', '  `--------\'                '],
      ['    |~~~~|    o             ', '    |    |   .              ', '    |  o |                  ', '   /      \\                 ', ' /   -  -   \\               ', '|     ‿‿     |              ', '|~~~~~~~~~~~~|              ', ' \\ ● ●  ○ ○ /               ', '  `--------\'                '],
      ['    |~~~~|                  ', '    | o  |      o           ', '    |    |    o             ', '   /      \\                 ', ' /   o  o   \\               ', '|     ‿‿     |              ', '|~-~~~~~~~-~~|              ', ' \\ ● ●  ○ ○ /               ', '  `--------\'                '],
    ],
    compact: [
      ['   |~~|     ', '   |  |     ', ' / o  o \\   ', '(  ~‿‿~  )  ', ' `-●●○○-\'   '],
      ['   |~~|     ', '   | o|     ', ' / -  - \\   ', '(  ~‿‿~  )  ', ' `-●●○○-\'   '],
      ['   |o~|     ', '   |  |     ', ' / o  o \\   ', '(  ~‿‿~  )  ', ' `-●●○○-\'   '],
    ],
  },
}

/** Eye cells per frame ([row, col]); Phi has one, Phial two (left then right). */
const EYES: Table<PerFrame> = {
  phi: {
    full: [[[3, 19]], [[3, 19]], [[3, 19]]],
    compact: [[[2, 8]], [[2, 8]], [[2, 8]]],
  },
  phial: {
    full: [[[4, 5], [4, 8]], [[4, 5], [4, 8]], [[4, 5], [4, 8]]],
    compact: [[[2, 3], [2, 6]], [[2, 3], [2, 6]], [[2, 3], [2, 6]]],
  },
}

/** The four chamber cells per frame. */
const BELLS: Table<PerFrame> = {
  phi: {
    full: [[[6, 6], [6, 8], [6, 10], [6, 12]], [[6, 6], [6, 8], [6, 10], [6, 12]], [[6, 6], [6, 8], [6, 10], [6, 12]]],
    compact: [[[4, 3], [4, 4], [4, 5], [4, 6]], [[4, 3], [4, 4], [4, 5], [4, 6]], [[4, 3], [4, 4], [4, 5], [4, 6]]],
  },
  phial: {
    full: [[[7, 3], [7, 5], [7, 8], [7, 10]], [[7, 3], [7, 5], [7, 8], [7, 10]], [[7, 3], [7, 5], [7, 8], [7, 10]]],
    compact: [[[4, 3], [4, 4], [4, 5], [4, 6]], [[4, 3], [4, 4], [4, 5], [4, 6]], [[4, 3], [4, 4], [4, 5], [4, 6]]],
  },
}

/** Interior cells that are spaces in all three frames, in fill order. */
const BARNACLES: Table<Cell[]> = {
  phi: {
    full: [[2, 6], [2, 10], [4, 4], [4, 12]],
    compact: [[1, 2], [1, 6], [3, 2], [3, 6]],
  },
  phial: {
    full: [[1, 5], [1, 8], [2, 5], [2, 8]],
    compact: [[3, 1], [3, 2], [3, 7], [3, 8]],
  },
}

const FILLED = '●'
const EMPTY = '○'

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

function eyeGlyphs(body: Body, mood: Mood, n: number): string[] {
  if (mood === 'shielding' && body === 'phial') return ['>', '<']
  return Array.from({ length: n }, () => EYE_GLYPH[mood])
}

/** Where the eyes are in these rows, as drawn (facing right): [row, column] per eye. */
export function eyeCellsOf(rows: string[], body: Body, size: Size): Array<[number, number]> {
  return (EYES[body][size][frameIndexOf(rows, body, size)] ?? []).map(([r, c]) => [r, c] as [number, number])
}

export function withMood(rows: string[], body: Body, size: Size, mood: Mood): string[] {
  const cells = EYES[body][size][frameIndexOf(rows, body, size)] ?? []
  return put(rows, cells, eyeGlyphs(body, mood, cells.length))
}

export function withBells(rows: string[], body: Body, size: Size, rung: number): string[] {
  const cells = BELLS[body][size][frameIndexOf(rows, body, size)] ?? []
  const n = Math.max(0, Math.min(4, Math.trunc(rung)))
  return put(rows, cells, cells.map((_, k) => (k < n ? FILLED : EMPTY)))
}

export function withBarnacles(rows: string[], body: Body, size: Size, count: number): string[] {
  const all = BARNACLES[body][size]
  const n = Math.max(0, Math.min(all.length, Math.trunc(count)))
  return put(rows, all.slice(0, n), all.slice(0, n).map(() => '*'))
}
