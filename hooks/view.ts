// The band's view model: everything the drawing needs, from plain state. Pure.

import type { Activity, Ask, Barnacle, Blush, Body, Candidate, Costume, Haemorrhage, Hold, Ledger, Size, Speech } from '../types'
import { counts, nm } from './asks'
import { bellHalves, isIdle } from './bells'
import { colourFor, moodFor, speechBox } from './body'
import { blushLevel, blushLive, haemorrhageLive, lampLive } from './blush'
import { unsettled } from './notes'
import { bellCellsOf, blushCellsOf, eyeCellsOf, frame, propCells, shellDecor, withBells, withDecor, withMood, withProp } from './sprites'
import type { Decor } from './sprites'
import { refusalLive, refusalRed } from './refusal'
import type { Refusal } from './refusal'
import { paleCount, share } from './witness'

export const SAFELIGHT = '#C0392B'
/** Compact grew from 12 to 14 columns for the chime at the creature's back (1.1, Bradley 2026-10-09). */
export const SPRITE_WIDTH: Readonly<Record<Size, number>> = { compact: 14 }
/** The row of the creature's eye per body and size; the speech tail sits on it. */
export const EYE_ROW: Readonly<Record<Body, Record<Size, number>>> = {
  phi: { compact: 2 },
  phial: { compact: 2 },
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
  /** A write another guard refused (1.4.0): red and REFUSED while it is live. Display only. */
  refusal?: Refusal | null
  /** Far more rows than named (1.7): the whole creature red and HAEMORRHAGE, like a refusal. Display only. */
  haemorrhage?: Haemorrhage | null
  /** The safelight blush (1.7): part of the shell red for an irreversible call. Yields to every full red. */
  blush?: Blush | null
  /** The lamp test's end (1.7, epoch ms): the whole creature red until then, no bubble. */
  lamp?: number | null
  barnacles: Barnacle[]
  /** The hook and skill candidates (1.5): each one not yet settled is a gem on the shell. */
  candidates?: Candidate[]
  working: boolean
  rowsLanded: boolean
  maxRows: number
  bodyColumns: number
  /** `left`: the creature sits at the right edge and faces its bubble. Default right (as drawn). */
  facing?: 'left' | 'right'
  /** What Naut wears (the /wear command, 1.1); `none` by default. A costume shows on the compact Naut only. */
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
  /** The cells the drawn barnacles occupy in `sprite` after the gems have shared the shell, as drawn; they take their own ink (1.1). */
  barnacles: Array<[number, number]>
  /** The cells the hook gems occupy in `sprite`, as drawn; green (1.5). */
  hookGems: Array<[number, number]>
  /** The cells the skill gems occupy in `sprite`, as drawn; blue (1.5). */
  skillGems: Array<[number, number]>
  /** The cells the blush reddens, as drawn (1.7); empty when a full red is showing or nothing blushes. */
  blush: Array<[number, number]>
  /** The blush's colour (1.10.0): rung 1 and a refusal's afterglow are amber, rungs 2 and 3 red. */
  blushLevel: 'amber' | 'red'
  /** The cells the worn costume occupies in `sprite`, as drawn; red (1.1). Empty when Naut wears nothing. */
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
export function statusLine(ledger: Ledger, asks: Ask[], hold: Hold | null, refused = false, bled = false): string {
  const claims = ledger.claims.length
  const parts = [`asks ${nm(asks)}`]
  const c = counts(asks)
  if (c.carried > 0) parts.push(`carried ${c.carried}`)
  if (c.builds > 0) parts.push(`builds ${c.builds}`)
  if (claims > 0) parts.push(`witnessed ${claims - paleCount(ledger)}/${claims}`)
  if (hold !== null) parts.push('HELD')
  else if (refused) parts.push('REFUSED')
  else if (bled) parts.push('HAEMORRHAGE')
  return parts.join(' · ')
}

/** Where the shell's decorations go: barnacles and the waiting candidates share four cells (1.5). */
function decorOf(v: ViewInput, size: Size): Decor {
  const waiting = unsettled(v.candidates ?? [])
  return shellDecor(v.body, size, {
    barnacles: v.barnacles.length,
    hooks: waiting.filter(c => c.kind === 'hook').length,
    skills: waiting.filter(c => c.kind === 'skill').length,
  })
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
  const crusted = withDecor(belled, decorOf(v, size))
  const costume = v.costume ?? 'none'
  return costume === 'none' ? crusted : withProp(crusted, v.body, size, costume)
}

export function buildView(v: ViewInput): View {
  const speech = liveSpeech(v.speech, v.hold, v.now)
  // The full red (the hold, a refusal, a haemorrhage, the lamp test) wins over the blush (1.7).
  const refused = refusalLive(v.refusal, v.now)
  const bled = haemorrhageLive(v.haemorrhage, v.now)
  // A refusal is whole-creature red for its first REFUSAL_RED_MS only; after that the rim stays amber (1.10.0).
  const safelight = v.hold !== null || refusalRed(v.refusal, v.now) || bled || lampLive(v.lamp, v.now)
  // One size remains: the full-size companion was removed in 1.3.9.
  const size: Size = 'compact'
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
  const decor = decorOf(v, size)
  const barnacles = asDrawn(decor.barnacles)
  const hookGems = asDrawn(decor.hooks)
  const skillGems = asDrawn(decor.skills)
  const blushing = !safelight && blushLive(v.blush, v.now)
  // A refusal past its red is the rim, amber, unless a redder blush is showing.
  const redBlush = blushing && (v.blush?.rung ?? 1) !== 1
  const afterglow = !safelight && refused && !redBlush
  const blushRung = redBlush ? (v.blush?.rung ?? 1) : blushing || afterglow ? 1 : 0
  const blush = blushRung === 0 ? [] : asDrawn(blushCellsOf(v.body, size, blushRung))
  const blushTone = blushLevel(blushRung)
  const worn = v.costume ?? 'none'
  const costume =
    worn === 'none' || v.body !== 'phi' || size !== 'compact'
      ? []
      : asDrawn(propCells(worn).map(([r, c]): [number, number] => [r, c]))
  return {
    size,
    sprite: left ? mirror(sprite) : sprite,
    colour: colourFor(v.body, share(v.ledger)),
    safelight,
    eyes,
    bells,
    barnacles,
    hookGems,
    skillGems,
    blush,
    blushLevel: blushTone,
    costume,
    status: statusLine(v.ledger, v.asks, v.hold, refused, bled),
    speech: box,
    bubble: speech === null ? null : { header: speech.header, text: speech.text },
  }
}
