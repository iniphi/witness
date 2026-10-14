// A calibrated jewel's ruling (1.12): `calibrate all` settles every listed jewel `taken` once the
// box takes the text, and a settle is never changed. The ruling that follows (built, or dismissed)
// is recorded ON TOP of the taken settle, in an optional `ruled` field, so a record written by an
// older version reads exactly as before. Pure.

import type { Candidate } from '../types'

export type Ruling = 'built' | 'dismissed'

/** Dismissed: settled dismissed, or taken and then ruled dismissed. A built jewel was acted on, not dismissed. */
export function isDismissed(c: Candidate): boolean {
  return c.settled?.how === 'dismissed' || (c.settled?.how === 'taken' && c.ruled?.how === 'dismissed')
}

/** The jewels that were taken (ruled or not), in a stable order: seen first to last, then by key. */
export function rulingList(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter(c => c.settled?.how === 'taken').sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export type RulingAsk = { kind: 'open' } | { kind: 'list' } | { kind: 'usage' } | { kind: 'rule'; how: Ruling; refs: string[] }

/** The `/jewels` arguments: none opens the pane; `taken` lists; `built|dismissed <n or key>...` rules. */
export function parseRuling(args: unknown): RulingAsk {
  const text = typeof args === 'string' ? args.trim() : ''
  if (text === '') return { kind: 'open' }
  const [word = '', ...rest] = text.split(/[\s,]+/).filter(t => t !== '')
  const w = word.toLowerCase()
  if (w === 'taken' || w === 'list') return { kind: 'list' }
  const how: Ruling | null = w === 'built' ? 'built' : w === 'dismissed' || w === 'dismiss' ? 'dismissed' : null
  if (how === null || rest.length === 0) return { kind: 'usage' }
  return { kind: 'rule', how, refs: rest }
}

/**
 * Rules the taken jewels named by `refs` (a 1-based number in rulingList, or a key), all against
 * the one snapshot. Only taken to built or taken to dismissed; the same ruling again is a no-op
 * that says so; a ruling is never changed; anything not taken is refused. Never mutates `candidates`.
 */
export function ruleIn(candidates: readonly Candidate[], refs: readonly string[], how: Ruling, at: number): { next: Candidate[]; lines: string[] } {
  const taken = rulingList(candidates)
  const ruled = new Map<string, Candidate>()
  const lines: string[] = []
  for (const ref of refs) {
    const found = /^\d+$/.test(ref) ? taken[Number(ref) - 1] : candidates.find(c => c.key === ref)
    if (found === undefined) {
      lines.push(`No jewel ${ref} among the taken ones.`)
      continue
    }
    const c = ruled.get(found.key) ?? found
    if (c.settled?.how !== 'taken') {
      lines.push(`Refused: ${c.title} is ${c.settled === undefined ? 'not settled' : c.settled.how}; only a taken jewel is ruled.`)
    } else if (c.ruled === undefined) {
      ruled.set(c.key, { ...c, ruled: { how, at } })
      lines.push(`Ruled ${how}: ${c.title}`)
    } else if (c.ruled.how === how) {
      lines.push(`Already ruled ${how}: ${c.title}`)
    } else {
      lines.push(`Not changed: ${c.title} is already ruled ${c.ruled.how}.`)
    }
  }
  return { next: candidates.map(c => ruled.get(c.key) ?? { ...c }), lines }
}

/** The taken jewels, numbered, each with its state and key: the answer to `/jewels taken`. */
export function rulingText(candidates: readonly Candidate[]): string {
  const taken = rulingList(candidates)
  if (taken.length === 0) return 'No jewel has been taken yet, so none is waiting for a ruling.'
  const rows = taken.map(
    (c, n) => `${n + 1}. [${c.ruled?.how ?? 'taken'}] ${c.kind === 'hook' ? 'Hook' : 'Skill'}: ${c.title} (${c.key})`,
  )
  return [`${taken.length} jewel${taken.length === 1 ? ' was' : 's were'} taken (/jewels built N | /jewels dismissed N):`, ...rows].join('\n')
}
