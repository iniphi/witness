import type { Body, Mood } from '../types'

/**
 * The one place the `body` option is read. `naut` is the documented value; `phi` is the older
 * name for the same nautilus and stays accepted. The internal identifier stays `phi` (it keys
 * the sprite, eye, blush and prop tables), so the rest of the code sees one canonical value.
 * `phial` is the flask; anything else is the nautilus, as before the rename.
 */
export function bodyFromOption(value: unknown): Body {
  return value === 'phial' ? 'phial' : 'phi'
}

const PALE: Record<Body, string> = { phi: '#CFC8BC', phial: '#BFD0D3' }
const DEEP: Record<Body, string> = { phi: '#876D4C', phial: '#B9771F' }

/**
 * The inks the chime and the barnacles wear live, apart from the body colour, the way the
 * metered eye already does (Bradley, 2026-10-09): iniphi teal for the bells, iniphi gold for
 * the barnacles. A held write's safelight still colours the whole creature.
 */
export const INKS: Readonly<{ bells: string; barnacles: string; costume: string; hookGem: string; skillGem: string; blush: string; blushAmber: string }> = {
  bells: '#649090',
  barnacles: '#B59670',
  // The gem on the shell (1.5, Bradley 2026-10-11): green for a hook candidate, blue for a skill candidate.
  // Theme keys, never hex, so they follow the person's light or dark theme as the costume's error does.
  hookGem: 'success',
  skillGem: 'suggestion',
  // A costume is red (Bradley's live look, 2026-10-09): the theme's error colour, never a hex, as the lab draws every prop.
  costume: 'error',
  // The blush (1.7, Bradley 2026-10-11) is the same theme key: red is one colour, and the extent says how bad.
  blush: 'error',
  // Amber below red (1.10.0, Bradley 2026-10-11): rung 1 and a refusal's afterglow wear the theme's warning colour.
  blushAmber: 'warning',
}

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
}

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0').toUpperCase()
}

/** Pale to deep as the developed share rises; null (no claims) counts as 0. */
export function colourFor(body: Body, share: number | null): string {
  const t = share === null || Number.isNaN(share) ? 0 : Math.max(0, Math.min(1, share))
  const parts = [0, 1, 2].map((i) => {
    const a = channel(PALE[body], i)
    const b = channel(DEEP[body], i)
    return toHex(a + (b - a) * t)
  })
  return '#' + parts.join('')
}

export type MoodInput = {
  held: boolean
  working: boolean
  idle: boolean
  pale: number
  claims: number
  asksDone: number
  asksTotal: number
  rowsLanded: boolean
}

export function moodFor(m: MoodInput): Mood {
  if (m.held) return 'shielding'
  if (m.rowsLanded) return 'alert'
  if (m.idle) return 'resting'
  if (m.pale > 0) return 'doubtful'
  if (m.claims > 0 && m.pale === 0 && m.asksTotal > 0 && m.asksDone === m.asksTotal) return 'proud'
  return 'calm'
}

export type SpeechInput = {
  header: string
  text: string
  width: number
  maxHeight: number
  tailRow: number
}

/** Greedy word wrap; a word longer than the line is split. Never returns an empty list. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const raw of text.split(/\s+/).filter((w) => w.length > 0)) {
    let word = raw
    while (word.length > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, width))
      word = word.slice(width)
    }
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

function cutTo(lines: string[], room: number, width: number): string[] {
  if (lines.length <= room) return lines
  const kept = lines.slice(0, room)
  const last = kept[room - 1] ?? ''
  const base = last.length + 3 > width ? last.slice(0, width - 3) : last
  kept[room - 1] = base.replace(/\s+$/, '') + '...'
  return kept
}

function topBorder(header: string, width: number): string {
  const room = width - 2
  const label = header ? ' ' + header + ' ' : ''
  const shown = label.length > room - 1 ? label.slice(0, Math.max(0, room - 1)) : label
  return '╭' + '─' + shown.padEnd(room - 1, '─') + '╮'
}

export function speechBox(s: SpeechInput): string[] {
  const width = Math.max(6, Math.trunc(s.width))
  const room = Math.max(1, Math.trunc(s.maxHeight) - 2)
  const inner = width - 4
  const body = cutTo(wrap(s.text, inner), room, inner)
  const rows = body.map((t) => '│ ' + t.padEnd(inner, ' ') + ' │')
  const tail = Math.max(1, Math.min(rows.length, Math.trunc(s.tailRow))) - 1
  rows[tail] = '<' + (rows[tail] ?? '').slice(1)
  return [topBorder(s.header, width), ...rows, '╰' + '─'.repeat(width - 2) + '╯']
}
