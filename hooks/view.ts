// The band's view model: everything the drawing needs, from plain state. Pure.

import type { Activity, Ask, Barnacle, Body, Hold, Ledger, Size, Speech } from '../types'
import { counts, nm } from './asks'
import { bellsRung, isIdle } from './bells'
import { colourFor, moodFor, sizeFor, speechBox } from './body'
import { eyeCellsOf, frame, withBarnacles, withBells, withMood } from './sprites'
import { paleCount, share } from './witness'

export const SAFELIGHT = '#C0392B'
export const SPRITE_WIDTH: Readonly<Record<Size, number>> = { full: 28, compact: 12 }
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
}

export type View = {
  size: Size
  sprite: string[]
  colour: string
  safelight: boolean
  /** Where the eyes are in `sprite` ([row, column], columns in code points), as drawn. */
  eyes: Array<[number, number]>
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
  const belled = withBells(moody, v.body, size, bellsRung(v.activity))
  return withBarnacles(belled, v.body, size, v.barnacles.length)
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
  const eyes = eyeCellsOf(sprite, v.body, size).map(([r, c]): [number, number] =>
    left ? [r, Array.from(sprite[r] ?? '').length - 1 - c] : [r, c],
  )
  return {
    size,
    sprite: left ? mirror(sprite) : sprite,
    colour: colourFor(v.body, share(v.ledger)),
    safelight: v.hold !== null,
    eyes,
    status: statusLine(v.ledger, v.asks, v.hold),
    speech: box,
    bubble: speech === null ? null : { header: speech.header, text: speech.text },
  }
}
