// The sonar's wider pings (1.2, ruled by Bradley 2026-10-09). Beyond two pods writing one file
// (sonar.ts `overlaps`): a pod writing inside another live pod's repository, of which BOTH are
// told (the writer `into-theirs`, the owner `into-mine`: an Overseer /direction-pass writing
// 501_blog's files while a 501_blog session is live); and two pods writing the same Notion page
// or the same table by a direct statement. A SELECT-led writer function (`fn:` targets such as
// workspace.close_todo) is left out: nearly every session calls one. Pure.

import type { Beat, Overlap, OverlapKind, PodWrite } from '../types'
import { normPath } from './classify'
import { MAX_BEAT_WRITES, OVERLAP_MS } from './sonar'

const HEX32 = /^[0-9a-f]{32}$/
/** `schema.table` or `table`: a writer function (`fn:...`) or a sentinel (`other:...`) never matches. */
const TABLE = /^[a-z_][\w$]*(?:\.[a-z_][\w$]*)?$/i

type LedgerWrite = { kind: string; target: string; at: number }

/** The newest Notion page ids (`notion`) or directly written tables (`sql`) of a ledger, newest first. */
export function recentTargets(writes: readonly LedgerWrite[], now: number, kind: 'notion' | 'sql'): PodWrite[] {
  const newest = new Map<string, number>()
  for (const w of writes) {
    if (w.kind !== kind || !Number.isFinite(w.at) || w.at < now - OVERLAP_MS) continue
    const t = w.target.toLowerCase()
    if (kind === 'notion' ? !HEX32.test(t) : !TABLE.test(t)) continue
    if (w.at > (newest.get(t) ?? Number.NEGATIVE_INFINITY)) newest.set(t, w.at)
  }
  return [...newest]
    .map(([path, at]) => ({ path, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_BEAT_WRITES)
}

const keyOf = (o: Overlap): string => `${o.kind ?? 'file'}\u0000${o.path}\u0000${o.peer}`

/** One per (kind, path, peer), the newest kept, newest first. */
function distinct(found: readonly Overlap[]): Overlap[] {
  const out = new Map<string, Overlap>()
  for (const o of found) {
    const seen = out.get(keyOf(o))
    if (seen === undefined || o.at > seen.at) out.set(keyOf(o), { ...o })
  }
  return [...out.values()].sort((a, b) => b.at - a.at)
}

/** The things both this pod and `pod` wrote within the window: one list of one kind. */
function shared(mine: readonly PodWrite[], theirs: readonly PodWrite[], floor: number): Array<{ path: string; at: number }> {
  const them = new Map(theirs.filter(w => w.at >= floor).map(w => [w.path.toLowerCase(), w.at]))
  return mine
    .filter(w => w.at >= floor && them.has(w.path.toLowerCase()))
    .map(w => ({ path: w.path, at: Math.max(w.at, them.get(w.path.toLowerCase()) ?? w.at) }))
}

/** The Notion pages and tables this pod and another live pod both wrote lately. */
export function storeOverlaps(o: { notion: readonly PodWrite[]; tables: readonly PodWrite[]; pods: readonly Beat[]; now: number }): Overlap[] {
  const floor = o.now - OVERLAP_MS
  const found: Overlap[] = []
  for (const pod of o.pods) {
    const as = (kind: OverlapKind) => (x: { path: string; at: number }): Overlap => ({ ...x, peer: pod.sessionId, peerName: pod.name, kind })
    found.push(...shared(o.notion, pod.notion ?? [], floor).map(as('notion')))
    found.push(...shared(o.tables, pod.tables ?? [], floor).map(as('table')))
  }
  return distinct(found)
}

const under = (path: string, dir: string): boolean => dir !== '' && normPath(path).startsWith(`${normPath(dir)}/`)

/**
 * Writes inside another live pod's repository. Two pods in the SAME repository share it, so
 * neither intrudes (a file both wrote is `overlaps`' business); a pod with no repository is
 * intruded on by nobody, though its own writes into a live pod's repository are seen.
 */
export function intrusions(o: { mine: readonly PodWrite[]; myRoot: string | null; pods: readonly Beat[]; now: number }): Overlap[] {
  const floor = o.now - OVERLAP_MS
  const mineRoot = o.myRoot === null ? '' : normPath(o.myRoot)
  const found: Overlap[] = []
  for (const pod of o.pods) {
    const theirRoot = pod.root === null ? '' : normPath(pod.root)
    if (theirRoot === mineRoot) continue
    const as = (kind: OverlapKind) => (w: PodWrite): Overlap => ({ path: w.path, at: w.at, peer: pod.sessionId, peerName: pod.name, kind })
    found.push(...o.mine.filter(w => w.at >= floor && under(w.path, theirRoot)).map(as('into-theirs')))
    found.push(...pod.writes.filter(w => w.at >= floor && under(w.path, mineRoot)).map(as('into-mine')))
  }
  return distinct(found)
}
