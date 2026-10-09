// The band's view model: everything the drawing needs, from plain state. Pure.

import type { Activity, Ask, Barnacle, Body, Costume, Hold, Ledger, Size, Speech } from '../types'
import { counts, nm } from './asks'
import { bellHalves, isIdle } from './bells'
import { colourFor, moodFor, sizeFor, speechBox } from './body'
import { barnacleCellsOf, bellCellsOf, eyeCellsOf, frame, propCells, withBarnacles, withBells, withMood, withProp } from './sprites'
import { paleCount, share } from './witness'

export const SAFELIGHT = '#C0392B'
/** Compact grew from 12 to 14 columns for the chime at the creature's back (1.1, Bradley 2026-10-09). */
export const SPRITE_WIDTH: Readonly<Record<Size, number>> = { full: 28, compact: 14 }
/** The row of the creature's eye per body and size; the speech tail sits on it. */
export const EYE_ROW: Readonly<Record<Body, Record<Size, number>>> = {
  phi: { full: 3, compact: 2 },
  phial: { full: 4, compact: 2 },
}
const MAX_SPEECH_WIDTH = 64
const MIN_SPEECH_WIDTH = 16

export type ViewInput = {
  body: Body
  frameIndex: number
  ledger: Ledger
  asks: Ask[]
  activity: Activity
  now: number
  speech: Speech | null
  hold: Hold | null
  barnacles: Barnacle[]
  working: boolean
  rowsLanded: boolean
  maxRows: number
  bodyColumns: number
  /** `left`: the creature sits at the right edge and faces its bubble. Default right (as drawn). */
  facing?: 'left' | 'right'
  /** What Phi wears (the /wear command, 1.1); `none` by default. A costume shows on the compact Phi only. */
  costume?: Costume
}

export type View = {
  size: Size
  sprite: string[]
  colour: string
  safelight: boolean
  /** Where the eyes are in `sprite` ([row, column], columns in code points), as drawn. */
  eyes: Array<[number, number]>
  /** The chime's four bell cells in `sprite`, top to bottom, as drawn; they take their own ink (1.1). */
  bells: Array<[number, number]>
  /** The cells the drawn barnacles occupy in `sprite`, as drawn; they take their own ink (1.1). */
  barnacles: Array<[number, number]>
  /** The cells the worn costume occupies in `sprite`, as drawn; red (1.1). Empty when Phi wears nothing. */
  costume: Array<[number, number]>
  status: string
  /** The speech as box-drawn rows (kept for the full-size print and tests). */
  speech: string[]
  /** The speech as plain data, for the band's bubble beside the creature. */
  bubble: { header: string; text: string } | null
}

/** Each glyph's mirror image; anything else is its own. */
const MIRROR: Readonly<Record<string, string>> = {
  '/': '\\',
  '\\': '/',
  '(': ')',
  ')': '(',
  '<': '>',
  '>': '<',
  // The horn tips are stored as 9 9 and read 6 6 on screen (Bradley, 2026-10-09); the lab's pair.
  '6': '9',
  '9': '6',
  // A half bell keeps its black half toward the shell when the creature turns (1.1).
  '◐': '◑',
  '◑': '◐',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '`': "'",
  "'": '`',
}

/** The sprite facing the other way: each row reversed and its glyphs mirrored. Widths kept. */
export function mirror(rows: readonly string[]): string[] {
  return rows.map(row =>
    Array.from(row)
      .reverse()
      .map(c => MIRROR[c] ?? c)
      .join(''),
  )
}

export const HOLD_TEXT =
  'This write names nothing it touched. Add RETURNING (the CTE form), let it through once, or cancel.'

/** The speech that shows now: a hold always wins; an expired speech is gone. */
export function liveSpeech(speech: Speech | null, hold: Hold | null, now: number): Speech | null {
  if (hold !== null) return { header: 'HELD', text: HOLD_TEXT, full: true, until: null }
  if (speech === null) return null
  return speech.until !== null && speech.until <= now ? null : speech
}

/**
 * `asks 3/7 ~1 · witnessed 4/5 · HELD`, nothing absent shown as a zero. Trimmed to
 * what Bradley reads at a glance (S162): it rides on the ticket's one line.
 */
export function statusLine(ledger: Ledger, asks: Ask[], hold: Hold | null): string {
  const claims = ledger.claims.length
  const parts = [`asks ${nm(asks)}`]
  const c = counts(asks)
  if (c.carried > 0) parts.push(`carried ${c.carried}`)
  if (c.builds > 0) parts.push(`builds ${c.builds}`)
  if (claims > 0) parts.push(`witnessed ${claims - paleCount(ledger)}/${claims}`)
  if (hold !== null) parts.push('HELD')
  return parts.join(' · ')
}

function spriteRows(v: ViewInput, size: Size): string[] {
  const c = counts(v.asks)
  const mood = moodFor({
    held: v.hold !== null,
    working: v.working,
    idle: isIdle(v.activity, v.now),
    pale: paleCount(v.ledger),
    claims: v.ledger.claims.length,
    asksDone: c.done,
    asksTotal: c.total,
    rowsLanded: v.rowsLanded,
  })
  const base = frame(v.body, size, v.frameIndex)
  // Calm keeps each frame's own eye, so the idle frames can blink.
  const moody = mood === 'calm' ? base : withMood(base, v.body, size, mood)
  const belled = withBells(moody, v.body, size, bellHalves(v.activity))
  const crusted = withBarnacles(belled, v.body, size, v.barnacles.length)
  const costume = v.costume ?? 'none'
  return costume === 'none' ? crusted : withProp(crusted, v.body, size, costume)
}

export function buildView(v: ViewInput): View {
  const speech = liveSpeech(v.speech, v.hold, v.now)
  const size = sizeFor({
    moment: speech !== null && speech.full,
    maxRows: v.maxRows,
    bodyColumns: v.bodyColumns,
  })
  const sprite = spriteRows(v, size)
  const width = Math.min(MAX_SPEECH_WIDTH, v.bodyColumns - SPRITE_WIDTH[size] - 2)
  const box =
    speech !== null && width >= MIN_SPEECH_WIDTH
      ? speechBox({
          header: speech.header,
          text: speech.text,
          width,
          maxHeight: sprite.length - 1,
          tailRow: EYE_ROW[v.body][size] - 1,
        })
      : []
  const left = v.facing === 'left'
  // Cells as drawn: a creature turned to face left has every column counted from the far edge.
  const asDrawn = (cells: Array<[number, number]>): Array<[number, number]> =>
    cells.map(([r, c]): [number, number] => (left ? [r, Array.from(sprite[r] ?? '').length - 1 - c] : [r, c]))
  const eyes = asDrawn(eyeCellsOf(sprite, v.body, size))
  const bells = asDrawn(bellCellsOf(sprite, v.body, size))
  const barnacles = asDrawn(barnacleCellsOf(v.body, size, v.barnacles.length))
  const worn = v.costume ?? 'none'
  const costume =
    worn === 'none' || v.body !== 'phi' || size !== 'compact'
      ? []
      : asDrawn(propCells(worn).map(([r, c]): [number, number] => [r, c]))
  return {
    size,
    sprite: left ? mirror(sprite) : sprite,
    colour: colourFor(v.body, share(v.ledger)),
    safelight: v.hold !== null,
    eyes,
    bells,
    barnacles,
    costume,
    status: statusLine(v.ledger, v.asks, v.hold),
    speech: box,
    bubble: speech === null ? null : { header: speech.header, text: speech.text },
  }
}
