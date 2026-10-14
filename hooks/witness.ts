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
//
// A subagent's final report is a claim too (1.1, ruled 2026-10-09): pale at birth, it
// develops only when the MAIN loop reads back what the agent wrote, so a Director that
// only reads reports is held to the same rule as a model that says done.

import type { Claim, Classified, Ledger, Touch, TurnStat, Write } from '../types'
import { ALL_FILES, covers, isUnder, namedTargets } from './classify'

export {
  classify,
  covers,
  isUnder,
  namedTargets,
  normNotionId,
  normPath,
  notionIds,
  rowCount,
} from './classify'
export type { ToolCall } from './classify'

export const MAX_WRITES = 500
export const MAX_CLAIMS = 200
export const MAX_TURNS = 500
export const MAX_AGENTS = 200
export const CLAIM_TEXT_MAX = 160
/** The turn id an agent claim carries before the agent's id. */
export const AGENT_TURN = 'agent:'

/**
 * One tool call. `subagent` (or an `agentId`): the call ran inside a subagent - its
 * writes are recorded (unwitnessed, whatever classify said, and attributed to the
 * agent when its id is known), its reads witness nothing, and it does not count
 * toward the turn's stats.
 */
export type CallRecord = {
  turnId: string
  at: number
  ids: string[]
  classified: Classified
  subagent?: boolean
  agentId?: string
}
export type TurnRecord = { turnId: string; at: number; answer: string; id: string }
/** A subagent's final report: its own `turn.complete` (1.1). */
export type AgentTurnRecord = { agentId: string; at: number; answer: string; id: string; schemas?: readonly string[] }

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
 * unwitnessed writes pile past the bound, the oldest of them go too. An agent
 * claim is left to readBack: a write witnessed before its report proves nothing
 * about the report.
 */
function develop(claims: Claim[], writes: Write[]): Claim[] {
  const witnessed = new Set(writes.filter((w) => w.witnessed).map((w) => w.id))
  return claims.map((c) =>
    c.state === 'pale' && c.agentId === undefined && c.writeIds.length > 0 && c.writeIds.every((id) => witnessed.has(id))
      ? { ...c, state: 'developed' as const }
      : c,
  )
}

const isAbsolutePath = (p: string): boolean => /^([a-z]:)?\//.test(p)

/**
 * Does this read reach a target a report named? The same target, or for a file a
 * folder read above it, or (for a relative name) a path ending in it; never the `*`
 * of a test run, which reads no named thing.
 */
export function readsName(read: Touch, name: Touch): boolean {
  if (read.kind !== name.kind) return false
  if (read.target === name.target) return true
  if (name.kind !== 'file' || read.target === ALL_FILES) return false
  return isAbsolutePath(name.target) ? isUnder(name.target, read.target) : read.target.endsWith(`/${name.target}`)
}

/**
 * A pale agent claim's read-back: the reads of one MAIN-loop call, all made after the
 * report. With writes, it develops once each has been covered by such a read (a
 * dropped write never is); resting on none, once one target the report names is
 * read; naming none, it stays pale.
 */
function readBack(claims: Claim[], reads: Classified['reads'], writes: Write[]): Claim[] {
  if (reads.length === 0) return claims
  const byId = new Map(writes.map((w) => [w.id, w]))
  const covered = (id: string): boolean => {
    const w = byId.get(id)
    return w !== undefined && reads.some((r) => covers(r, w))
  }
  return claims.map((c) => {
    if (c.agentId === undefined || c.state !== 'pale') return c
    if (c.writeIds.length === 0) {
      const named = (c.names ?? []).some((n) => reads.some((r) => readsName(r, n)))
      return named ? { ...c, state: 'developed' as const } : c
    }
    const owed = c.unread ?? c.writeIds
    const unread = owed.filter((id) => !covered(id))
    if (unread.length === owed.length) return c
    return unread.length === 0 ? { ...c, unread, state: 'developed' as const } : { ...c, unread }
  })
}

function bumpTurn(turns: Ledger['turns'], turnId: string, reads: number, writes: number): Ledger['turns'] {
  const t = turns[turnId] ?? ZERO
  return { ...turns, [turnId]: { calls: t.calls + 1, reads: t.reads + reads, writes: t.writes + writes } }
}

function countAgent(agents: Ledger['agents'], agentId: string): Record<string, number> {
  const all = agents ?? {}
  return { ...all, [agentId]: (all[agentId] ?? 0) + 1 }
}

/** Record one tool call: add its writes, witness earlier writes its reads cover, develop claims. */
export function recordCall(ledger: Ledger, rec: CallRecord): Ledger {
  const sub = rec.subagent === true || rec.agentId !== undefined
  // A subagent's unknown call is never an unwitnessable write: nothing could clear it.
  const writes = sub ? rec.classified.writes.filter((w) => w.kind !== 'other') : rec.classified.writes
  const reads = sub ? [] : rec.classified.reads
  const prior = ledger.writes.map((w) => witnessBy(w, reads))
  // An agent's write still rides the main turn's id; it is attributed, so its report can claim it.
  const by = rec.agentId === undefined ? {} : { agentId: rec.agentId }
  const added = writes.map(
    (w, i): Write => ({
      kind: w.kind,
      target: w.target,
      id: rec.ids[i] ?? `${rec.turnId}#${rec.at}#${i}`,
      turnId: rec.turnId,
      at: rec.at,
      witnessed: !sub && w.selfWitnessed,
      ...by,
    }),
  )
  const all = [...prior, ...added]
  const agents = rec.agentId === undefined ? ledger.agents : countAgent(ledger.agents, rec.agentId)
  return bound({
    writes: all,
    claims: readBack(develop(ledger.claims, all), reads, all),
    turns: sub ? ledger.turns : bumpTurn(ledger.turns, rec.turnId, reads.length, writes.length),
    ...(agents === undefined ? {} : { agents }),
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

/** The latest claim made by another main turn, or null. An agent's report is not the main loop's claim. */
function previousClaim(claims: Claim[], turnId: string): Claim | null {
  return claims.reduce<Claim | null>(
    (p, c) => (c.agentId === undefined && c.turnId !== turnId && (p === null || c.at >= p.at) ? c : p),
    null,
  )
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

/** The turn id of an agent's claim: one claim per agent, its latest report. */
export function agentTurnId(agentId: string): string {
  return `${AGENT_TURN}${agentId}`
}

/**
 * A subagent's final report (1.1). Minted when the answer claims done AND the agent
 * made at least one tool call this mod saw: the engine's own forks (compaction,
 * memory) carry ids no list names, and their "Memory updated." is not a report.
 * Pale at birth, even over writes already witnessed: it rests on that agent's own
 * writes, each owed a main-loop read made after the report, or, resting on none, on
 * the targets the report names. A later report from the same agent replaces it and
 * keeps its id, so the asks riding on it stay linked.
 */
export function recordAgentTurn(ledger: Ledger, rec: AgentTurnRecord): { ledger: Ledger; claim: Claim | null } {
  if ((ledger.agents?.[rec.agentId] ?? 0) === 0 || !isDoneClaim(rec.answer)) return { ledger, claim: null }
  const turnId = agentTurnId(rec.agentId)
  const writeIds = ledger.writes.filter((w) => w.agentId === rec.agentId).map((w) => w.id)
  const prior = ledger.claims.find((c) => c.turnId === turnId)
  const claim: Claim = {
    id: prior?.id ?? rec.id,
    turnId,
    text: claimText(rec.answer),
    at: rec.at,
    writeIds,
    state: 'pale',
    agentId: rec.agentId,
    unread: writeIds,
    names: writeIds.length === 0 ? namedTargets(rec.answer, rec.schemas) : [],
  }
  const claims = [...ledger.claims.filter((c) => c.turnId !== turnId), claim]
  return { ledger: bound({ ...ledger, claims }), claim }
}

/** A claim as the pane names it: an agent's report says so (1.1). */
export function claimLabel(c: Pick<Claim, 'text' | 'agentId'>): string {
  return c.agentId === undefined ? c.text : `agent claim: ${c.text}`
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

function boundAgents(agents: Record<string, number>): Record<string, number> {
  const keys = Object.keys(agents)
  if (keys.length <= MAX_AGENTS) return agents
  return Object.fromEntries(keys.slice(keys.length - MAX_AGENTS).map((k) => [k, agents[k] as number]))
}

/** The ledger held to its bounds: 500 writes, 200 claims, 500 turns, 200 agents. */
export function bound(ledger: Ledger): Ledger {
  return {
    writes: dropOldest(ledger.writes, MAX_WRITES, (w) => w.witnessed),
    claims: dropOldest(ledger.claims, MAX_CLAIMS, (c) => c.state === 'developed'),
    turns: boundTurns(ledger.turns),
    ...(ledger.agents === undefined ? {} : { agents: boundAgents(ledger.agents) }),
  }
}
