// The claim ledger. It records the writes Claude makes, marks a write witnessed
// when a later read covers it, and decides whether a "done" Claude claims rests
// on witnessed writes (developed) or not (pale). A claim whose matched asks are
// all witnessed develops too (developByAsks).
// Pure: no DOM, no Node, no $; time and ids are arguments; never mutates.
//
// Ordering: a read witnesses only writes already in the ledger (made by an
// earlier call, this turn or before). Order WITHIN one call is settled by
// classify(), which marks such a write selfWitnessed.
//
// A wrong "developed" is the failure that matters: every rule here errs pale.

import type { Claim, Classified, Ledger, TurnStat, Write } from '../types'
import { covers } from './classify'

export {
  classify,
  covers,
  isUnder,
  normNotionId,
  normPath,
  notionIds,
  rowCount,
} from './classify'
export type { ToolCall } from './classify'

export const MAX_WRITES = 500
export const MAX_CLAIMS = 200
export const MAX_TURNS = 500
export const CLAIM_TEXT_MAX = 160

/**
 * One tool call. `subagent`: the call ran inside a subagent - its writes are
 * recorded (unwitnessed, whatever classify said), its reads witness nothing, and
 * it does not count toward the turn's stats.
 */
export type CallRecord = { turnId: string; at: number; ids: string[]; classified: Classified; subagent?: boolean }
export type TurnRecord = { turnId: string; at: number; answer: string; id: string }

const ZERO: TurnStat = { calls: 0, reads: 0, writes: 0 }

export function emptyLedger(): Ledger {
  return { writes: [], claims: [], turns: {} }
}

// ---------------------------------------------------------------- calls

function witnessBy(w: Write, reads: Classified['reads']): Write {
  return w.witnessed || !reads.some((r) => covers(r, w)) ? w : { ...w, witnessed: true }
}

/**
 * A pale claim develops once every one of its writes is in the ledger AND
 * witnessed. A write the bound has dropped counts as unwitnessed: once the
 * unwitnessed writes pile past the bound, the oldest of them go too.
 */
function develop(claims: Claim[], writes: Write[]): Claim[] {
  const witnessed = new Set(writes.filter((w) => w.witnessed).map((w) => w.id))
  return claims.map((c) =>
    c.state === 'pale' && c.writeIds.length > 0 && c.writeIds.every((id) => witnessed.has(id))
      ? { ...c, state: 'developed' as const }
      : c,
  )
}

function bumpTurn(turns: Ledger['turns'], turnId: string, reads: number, writes: number): Ledger['turns'] {
  const t = turns[turnId] ?? ZERO
  return { ...turns, [turnId]: { calls: t.calls + 1, reads: t.reads + reads, writes: t.writes + writes } }
}

/** Record one tool call: add its writes, witness earlier writes its reads cover, develop claims. */
export function recordCall(ledger: Ledger, rec: CallRecord): Ledger {
  const sub = rec.subagent === true
  // A subagent's unknown call is never an unwitnessable write: nothing could clear it.
  const writes = sub ? rec.classified.writes.filter((w) => w.kind !== 'other') : rec.classified.writes
  const reads = sub ? [] : rec.classified.reads
  const prior = ledger.writes.map((w) => witnessBy(w, reads))
  const added = writes.map(
    (w, i): Write => ({
      kind: w.kind,
      target: w.target,
      id: rec.ids[i] ?? `${rec.turnId}#${rec.at}#${i}`,
      turnId: rec.turnId,
      at: rec.at,
      witnessed: !sub && w.selfWitnessed,
    }),
  )
  const all = [...prior, ...added]
  return bound({
    writes: all,
    claims: develop(ledger.claims, all),
    turns: sub ? ledger.turns : bumpTurn(ledger.turns, rec.turnId, reads.length, writes.length),
  })
}

// ---------------------------------------------------------------- done claims

const DONE_WORDS = new Set([
  'done', 'fixed', 'shipped', 'landed', 'committed', 'pushed', 'merged', 'built', 'applied',
  'written', 'updated', 'completed', 'resolved', 'passing', 'works', 'live', 'finished',
  'complete', 'passed',
])
// "works" and "live" are common outside a verdict ("where files live"), so they
// count only after a word that makes them one ("it works", "is live").
const QUALIFIERS: Record<string, Set<string>> = {
  works: new Set(['it', 'now', 'everything', 'all', 'this', 'that']),
  live: new Set(['is', 'are', 'now', 'went', 'goes', 'gone']),
}
const ASKING = new Set(['how', 'what', 'why', 'where', 'whether', 'if'])
const NEGATORS = new Set([
  'not', 'never', 'no', 'cannot', 'isnt', 'wasnt', 'arent', 'werent', 'havent', 'hasnt', 'hadnt',
  'dont', 'doesnt', 'didnt', 'wont', 'cant', 'couldnt', 'shouldnt', 'wouldnt',
])
const NEGATION_WINDOW = 3

/** The answer with fenced and inline code removed. */
export function proseOf(answer: string): string {
  return answer
    .replace(/(```|~~~)[\s\S]*?(\1|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

function words(clause: string): string[] {
  return clause
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z']/g, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean)
}

const isNegator = (w: string): boolean => NEGATORS.has(w.replace(/'/g, '')) || w.endsWith("n't")

function isDoneWordAt(ws: string[], i: number): boolean {
  const w = ws[i] ?? ''
  if (!DONE_WORDS.has(w)) return false
  const q = QUALIFIERS[w]
  if (!q) return true
  return q.has(ws[i - 1] ?? '') && !ASKING.has(ws[i - 2] ?? '')
}

/** The first done-word in reading order, and whether a negator sits within three words before it. */
function firstDoneWord(prose: string): { negated: boolean } | null {
  const sentences = prose.split(/(?<=[.!?])\s+|\n+/)
  for (const sentence of sentences) {
    if (/\?[\s*_`)"'\]]*$/.test(sentence.trim())) continue
    for (const clause of sentence.split(/[,;:–—]|\s-\s/)) {
      const ws = words(clause)
      const i = ws.findIndex((_, k) => isDoneWordAt(ws, k))
      if (i >= 0) return { negated: ws.slice(Math.max(0, i - NEGATION_WINDOW), i).some(isNegator) }
    }
  }
  return null
}

/**
 * True when the answer, outside code, says work is finished: its first done-word
 * (questions skipped) is not negated within the three words before it.
 */
export function isDoneClaim(answer: string): boolean {
  const found = firstDoneWord(proseOf(answer))
  return found !== null && !found.negated
}

// ---------------------------------------------------------------- turns

/** The claim text: whitespace runs (newlines included) collapsed, then the first 160 characters. */
export function claimText(answer: string): string {
  return answer.replace(/\s+/g, ' ').trim().slice(0, CLAIM_TEXT_MAX)
}

/** The latest claim made by another turn, or null. */
function previousClaim(claims: Claim[], turnId: string): Claim | null {
  return claims.reduce<Claim | null>((p, c) => (c.turnId !== turnId && (p === null || c.at >= p.at) ? c : p), null)
}

/**
 * The writes a claim rests on: every write of this turn, plus every write still
 * unwitnessed that was made since the previous claim (in any turn) and is not
 * already that claim's. An edit left unread in a silent turn rides the next claim.
 */
function claimedWrites(ledger: Ledger, turnId: string): Write[] {
  const prev = previousClaim(ledger.claims, turnId)
  const since = prev?.at ?? Number.NEGATIVE_INFINITY
  const prevIds = new Set(prev?.writeIds ?? [])
  return ledger.writes.filter(
    (w) => w.turnId === turnId || (!w.witnessed && w.at >= since && !prevIds.has(w.id)),
  )
}

/**
 * End of a turn. When the answer claims done, a claim over claimedWrites():
 * developed when every one is witnessed AND the turn touched something (wrote,
 * or read at least once). A turn with no tool calls touched nothing: pale.
 * A second claim for the same turn replaces the first.
 */
export function recordTurn(ledger: Ledger, rec: TurnRecord): { ledger: Ledger; claim: Claim | null } {
  if (!isDoneClaim(rec.answer)) return { ledger, claim: null }
  const claimed = claimedWrites(ledger, rec.turnId)
  const stat = ledger.turns[rec.turnId] ?? ZERO
  const touched = claimed.some((w) => w.turnId === rec.turnId) || stat.writes > 0 || stat.reads > 0
  const developed = touched && claimed.every((w) => w.witnessed)
  const claim: Claim = {
    id: rec.id,
    turnId: rec.turnId,
    text: claimText(rec.answer),
    at: rec.at,
    writeIds: claimed.map((w) => w.id),
    state: developed ? 'developed' : 'pale',
  }
  const claims = [...ledger.claims.filter((c) => c.turnId !== rec.turnId), claim]
  return { ledger: bound({ ...ledger, claims }), claim }
}

/** What developByAsks needs of an ask: the claim it rides on and its state. */
export type AskLink = { claimId: string | null; state: string }

/**
 * A pale claim develops when it has at least one matched ask and every ask it
 * matched is witnessed (to-do 3f33...1b36). Writes the witness cannot read back
 * (an other:* SQL function call, a git push) would otherwise keep it pale for good
 * although its asks were proved by the confirm tool. A dropped matched ask is not
 * witnessed, so it keeps the claim pale. A claim no ask matched is left as it is.
 */
export function developByAsks(ledger: Ledger, asks: readonly AskLink[]): Ledger {
  const claims = ledger.claims.map((c) => {
    if (c.state !== 'pale') return c
    const matched = asks.filter((a) => a.claimId === c.id)
    return matched.length > 0 && matched.every((a) => a.state === 'witnessed')
      ? { ...c, state: 'developed' as const }
      : c
  })
  return claims.every((c, i) => c === ledger.claims[i]) ? ledger : { ...ledger, claims }
}

/** Developed claims over all claims; null when there are none. */
export function share(ledger: Ledger): number | null {
  if (ledger.claims.length === 0) return null
  return ledger.claims.filter((c) => c.state === 'developed').length / ledger.claims.length
}

export function paleCount(ledger: Ledger): number {
  return ledger.claims.filter((c) => c.state === 'pale').length
}

// ---------------------------------------------------------------- bounding

/** Keep at most `max` items: drop the oldest settled ones first, then the oldest of the rest. */
export function dropOldest<T>(items: T[], max: number, settled: (t: T) => boolean): T[] {
  const excess = items.length - max
  if (excess <= 0) return items
  const idx = items.map((_, i) => i)
  const order = [...idx.filter((i) => settled(items[i] as T)), ...idx.filter((i) => !settled(items[i] as T))]
  const drop = new Set(order.slice(0, excess))
  return items.filter((_, i) => !drop.has(i))
}

function boundTurns(turns: Ledger['turns']): Ledger['turns'] {
  const keys = Object.keys(turns)
  if (keys.length <= MAX_TURNS) return turns
  return Object.fromEntries(keys.slice(keys.length - MAX_TURNS).map((k) => [k, turns[k] as TurnStat]))
}

/** The ledger held to its bounds: 500 writes, 200 claims, 500 turns. */
export function bound(ledger: Ledger): Ledger {
  return {
    writes: dropOldest(ledger.writes, MAX_WRITES, (w) => w.witnessed),
    claims: dropOldest(ledger.claims, MAX_CLAIMS, (c) => c.state === 'developed'),
    turns: boundTurns(ledger.turns),
  }
}
