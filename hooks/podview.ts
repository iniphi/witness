// How the sonar is said (1.2): the band's count, the Pods pane's rows, and one line per overlap
// and per arriving pod. Moved out of sonar.ts when the wider pings (territory.ts) gave an overlap
// a kind, each kind said in its own words. Pure.

import type { Beat, Overlap, PodState } from '../types'
import { podLabel } from './sonar'

/** `45s`, `12m`, `3h`: floors, and a negative or unknown span reads as zero. */
export function fmtAge(ms: number): string {
  const s = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
}

const overlapId = (o: Overlap): string => `${o.kind ?? 'file'}\u0000${o.path}`

/** The band's pod count: nothing when alone, `pods 2`, or `pods 2 !1` with one thing two pods share. */
export function bandPods(pods: readonly Beat[], ov: readonly Overlap[]): string {
  if (pods.length === 0) return ''
  const things = new Set(ov.map(overlapId)).size
  return things === 0 ? `pods ${pods.length}` : `pods ${pods.length} !${things}`
}

/** One overlap in words, by its kind. */
export function overlapText(o: Overlap): string {
  switch (o.kind ?? 'file') {
    case 'notion':
      return `Notion page ${o.path} - ${o.peerName} wrote it too`
    case 'table':
      return `table ${o.path} - ${o.peerName} wrote it too`
    case 'into-theirs':
      return `you wrote ${o.path} inside ${o.peerName}'s repository while it is live`
    case 'into-mine':
      return `${o.peerName} wrote ${o.path} inside this repository`
    default:
      return `${o.path} - ${o.peerName} wrote it too`
  }
}

export type PodRow = { index: number; label: string; state: PodState; age: string; asks: string; goals: string[]; overlaps: string[] }

export function podRows(pods: readonly Beat[], ov: readonly Overlap[], now: number): PodRow[] {
  return pods.map((b, i) => ({
    index: i + 1,
    label: podLabel(b),
    state: b.state,
    age: fmtAge(now - b.beatAt),
    asks: b.asks,
    goals: [...b.goals],
    overlaps: [...new Set(ov.filter(o => o.peer === b.sessionId).map(overlapText))],
  }))
}

export function newcomerText(b: Beat): string {
  const goal = b.goals[0]
  return `${podLabel(b)} is live in this repo${goal === undefined ? '' : `: ${goal}`}`
}
