// The Jewels pane's words (/jewels, 1.6): the hook and skill candidates the witness has proposed,
// in full, and the plain-text answer for a run with no surface to place a pane. Pure.

import type { Candidate } from '../types'
import { wrapLines } from './notices'
import { queuedLine } from './charter'
import { unsettled } from './notes'
import { GEM } from './sprites'

export const JEWELS_TITLE = 'Jewels'

/** Most characters of a why or an evidence the pane shows; a longer one is cut and says so. */
export const JEWEL_FIELD_CAP = 600

/** Unsettled candidates, newest first. */
export function jewelsList(candidates: readonly Candidate[]): Candidate[] {
  return unsettled(candidates).sort((a, b) => b.at - a.at)
}

/**
 * How many jewels were built, taken (and not yet ruled) and dismissed (1.12). A taken jewel ruled
 * built or dismissed counts there, not as taken; a record with no `ruled` counts as before.
 */
export function settledCounts(candidates: readonly Candidate[]): { built: number; taken: number; dismissed: number } {
  let built = 0
  let taken = 0
  let dismissed = 0
  for (const c of candidates) {
    if (c.settled?.how === 'taken') {
      if (c.ruled?.how === 'built') built += 1
      else if (c.ruled?.how === 'dismissed') dismissed += 1
      else taken += 1
    } else if (c.settled?.how === 'dismissed') dismissed += 1
  }
  return { built, taken, dismissed }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeAge(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/** A field, capped at JEWEL_FIELD_CAP with a visible mark when it was cut. */
export function capField(text: string): string {
  const t = text.trim()
  return t.length <= JEWEL_FIELD_CAP ? t : `${t.slice(0, JEWEL_FIELD_CAP).trimEnd()} ... (cut)`
}

export const EMPTY_JEWELS = 'Nothing is proposed yet: the side pass proposes a hook or a skill when friction repeats.'

export function settledLine(candidates: readonly Candidate[]): string {
  const { built, taken, dismissed } = settledCounts(candidates)
  return `Settled: built ${built}, taken ${taken}, dismissed ${dismissed}.`
}

export function jewelHeading(c: Candidate): string {
  return `${GEM} ${c.kind === 'hook' ? 'Hook' : 'Skill'}: ${c.title}`
}

/** The lines under a jewel's heading: why, evidence, age and filed state, wrapped to `width`. */
export function jewelBody(c: Candidate, now: number, width: number): string[] {
  const filed = c.filed ? 'filed to the candidates file' : 'not filed yet'
  return [
    ...wrapLines(`Why: ${capField(c.why)}`, width),
    ...wrapLines(`Evidence: ${capField(c.evidence)}`, width),
    `Seen ${relativeAge(c.at, now)}; ${filed}.`,
  ]
}

/** The whole of the pane as text, for a run with no surface to place it. */
export function jewelsText(candidates: readonly Candidate[], now: number, width = 80, queued = 0): string {
  const list = jewelsList(candidates)
  const held = queued > 0 ? `\n${queuedLine(queued)}.` : ''
  if (list.length === 0) return `${EMPTY_JEWELS}${held}\n${settledLine(candidates)}`
  const blocks = list.map(c => [jewelHeading(c), ...jewelBody(c, now, width - 2).map(l => `  ${l}`)].join('\n'))
  return `${list.length} jewel${list.length === 1 ? '' : 's'} proposed, newest first:\n\n${blocks.join('\n\n')}${held}\n\n${settledLine(candidates)}`
}

/** The `calibrate all` ask (1.8): every listed jewel, numbered, in one text for the prompt box. */
export function calibrateAllText(items: readonly Candidate[]): string {
  const blocks = items.map(
    (c, n) => `${n + 1}. ${c.kind === 'hook' ? 'Hook' : 'Skill'}: ${c.title}\n   Why: ${capField(c.why)}\n   Evidence: ${capField(c.evidence)}`,
  )
  return [
    `Calibrate these ${items.length} witness jewels: for each, give your read, run an adversarial check, record it in the calibration ledger, and put the rulings to me in batches.`,
    '',
    blocks.join('\n\n'),
    '',
    'Take them in this order; say which you could not assess.',
  ].join('\n')
}

/** The Barnacles pane's one pointer line, or null with nothing unsettled. */
export function jewelsPointer(candidates: readonly Candidate[]): string | null {
  const n = unsettled(candidates).length
  return n === 0 ? null : `${GEM} ${n} jewel${n === 1 ? '' : 's'} proposed: /jewels`
}
