// The notice queue (Bradley, 2026-10-09): everything the bubble voices waits here, one
// shown at a time, `<n/m>` beside the Dismiss control when more than one waits. Order is
// the screen budget's (FAMILY.md section 4); nothing is dropped. Pure: time and ids are
// arguments.

import type { Notice, NoticeKind, NoticeQueue } from '../types'

/** Screen-budget order: a held write, a note from beneath, the witness's own speech, a guest. */
export const PRIORITY: Readonly<Record<NoticeKind, number>> = { held: 0, beneath: 1, own: 2, guest: 3 }

/** The key bound while a dismissable witness notice shows; the Button draws `0: Dismiss`. */
export const DISMISS_KEY = '0'
export const DISMISS_LABEL = 'Dismiss'

export const EMPTY_QUEUE: NoticeQueue = { items: [], seen: 0 }

export type NoticeInput = Omit<Notice, 'id' | 'at'>

function expired(n: Notice, now: number): boolean {
  return n.until !== null && n.until <= now
}

/** Stable by priority, then arrival. */
function ordered(items: readonly Notice[]): Notice[] {
  return items
    .map((n, i) => ({ n, i }))
    .sort((a, b) => PRIORITY[a.n.kind] - PRIORITY[b.n.kind] || a.n.at - b.n.at || a.i - b.i)
    .map(x => x.n)
}

/**
 * Adds a notice. One whose text is already waiting is not added twice: the waiting one
 * takes the newer header and expiry, keeping its place.
 */
export function enqueue(q: NoticeQueue, input: NoticeInput, id: string, at: number): NoticeQueue {
  const same = q.items.find(n => n.text === input.text && !expired(n, at))
  if (same !== undefined) {
    const items = q.items.map(n => (n === same ? { ...n, header: input.header, full: input.full, until: input.until } : n))
    return { ...q, items }
  }
  const fresh = q.items.filter(n => !(n.text === input.text && expired(n, at)))
  return { ...q, items: ordered([...fresh, { ...input, id, at }]) }
}

/** Drops what has expired, counting it as seen; an emptied queue starts its count again. */
export function settle(q: NoticeQueue, now: number): NoticeQueue {
  const live = q.items.filter(n => !expired(n, now))
  if (live.length === 0) return EMPTY_QUEUE
  const gone = q.items.length - live.length
  return gone === 0 ? q : { items: live, seen: q.seen + gone }
}

/** Removes one notice by id, as an answered held write is; it counts as seen. */
export function remove(q: NoticeQueue, id: string): NoticeQueue {
  const items = q.items.filter(n => n.id !== id)
  if (items.length === q.items.length) return q
  return items.length === 0 ? EMPTY_QUEUE : { items, seen: q.seen + 1 }
}

/** Only the witness's own notices: a held write is answered, a note from beneath is the engine's. */
export function dismissable(n: Notice | null): boolean {
  return n !== null && (n.kind === 'own' || n.kind === 'guest')
}

export type Showing = {
  /** The notice in the bubble; null when a note from beneath (the engine's) or nothing shows. */
  notice: Notice | null
  /** True when the note from beneath holds the bubble. */
  beneath: boolean
  /** Position of the one showing, 1-based; 0 when nothing shows. */
  n: number
  /** Everything waiting, the one showing included. */
  m: number
}

/**
 * What the bubble shows now. A note from beneath is the engine's, drawn by it and
 * dismissed with its own controls: it is counted, never queued.
 */
export function showing(q: NoticeQueue, beneath: boolean, now: number): Showing {
  const live = q.items.filter(n => !expired(n, now))
  const gone = q.items.length - live.length
  const held = live.filter(n => n.kind === 'held')
  const rest = live.filter(n => n.kind !== 'held')
  const waiting = live.length + (beneath ? 1 : 0)
  if (waiting === 0) return { notice: null, beneath: false, n: 0, m: 0 }
  const seen = q.seen + gone
  const head = held[0] ?? (beneath ? null : (rest[0] ?? null))
  return { notice: head, beneath: head === null, n: seen + 1, m: seen + waiting }
}

/** Dismisses the witness notice showing; a held write or a note from beneath is left as it is. */
export function dismiss(q: NoticeQueue, beneath: boolean, now: number): NoticeQueue {
  const settled = settle(q, now)
  const shown = showing(settled, beneath, now).notice
  return shown !== null && dismissable(shown) ? remove(settled, shown.id) : settled
}

/** `<n/m>` when more than one waits; '' for a single notice. */
export function countText(n: number, m: number): string {
  return m > 1 && n > 0 ? `<${n}/${m}>` : ''
}

/** The footer as drawn: `0: Dismiss <n/m>`, either part absent when it does not apply. */
export function footerText(canDismiss: boolean, n: number, m: number): string {
  const dismissPart = canDismiss ? `${DISMISS_KEY}: ${DISMISS_LABEL}` : ''
  return [dismissPart, countText(n, m)].filter(p => p !== '').join(' ')
}

/** Greedy word wrap at `width` (a word longer than the line is split); never empty. */
export function wrapLines(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  for (const raw of text.split(/\s+/).filter(x => x.length > 0)) {
    let word = raw
    while (word.length > w) {
      if (line !== '') lines.push(line)
      line = ''
      lines.push(word.slice(0, w))
      word = word.slice(w)
    }
    if (line !== '' && line.length + 1 + word.length > w) {
      lines.push(line)
      line = word
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  if (line !== '') lines.push(line)
  return lines.length > 0 ? lines : ['']
}

/**
 * Where the footer goes without making the bubble taller: on the text's last row when it
 * fits there, otherwise on the header row.
 */
export function footerRow(lines: readonly string[], inner: number, footer: string): 'last' | 'header' {
  if (footer === '') return 'last'
  const last = lines[lines.length - 1] ?? ''
  return last.length + 1 + footer.length <= inner ? 'last' : 'header'
}
