// Immune memory (1.2, Bradley 2026-10-09): the repair pairs kept for a project, the epitopes
// that recur, the hook and skill candidates they become, and how a pair is said. Split from
// repair.ts (which finds the pairs) when that file passed 400 lines. Pure: no $, no clock, no
// argument mutated.

import type { Candidate, RepairDiff, RepairPair } from '../types'
import { cleanText } from './asks'
import { REPAIRS_KEPT, measured, shortTool } from './repair'

const TITLE_MAX = 80
const WHY_MAX = 160
const EVIDENCE_MAX = 200

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const cut = (text: string, max: number): string => {
  const t = cleanText(text)
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`
}

/** The pairs stored plus the fresh ones, the newest REPAIRS_KEPT kept. */
export function addPairs(stored: readonly RepairPair[], fresh: readonly RepairPair[]): RepairPair[] {
  return [...stored, ...fresh].slice(-REPAIRS_KEPT)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const ANTIGEN_KEYS = ['tool', 'code', 'kind', 'target', 'fragment', 'reason']
const TEXT_KEYS = ['key', 'failedTool', 'failed', 'cureTool', 'cured']
const NUM_KEYS = ['failures', 'cost', 'firstAt', 'at']
const pick = (o: Obj, keys: readonly string[]): Obj => Object.fromEntries(keys.map((k) => [k, o[k]]))

function asDiff(v: unknown): RepairDiff | null {
  if (!isObj(v) || !['content', 'route', 'none'].includes(v.where as string) || !strs(v.removed) || !strs(v.added)) return null
  return { where: v.where as RepairDiff['where'], removed: [...v.removed], added: [...v.added] }
}

function asPair(v: unknown): RepairPair | null {
  if (!isObj(v) || !isObj(v.antigen)) return null
  const diff = asDiff(v.diff)
  const ok =
    ANTIGEN_KEYS.every((k) => isStr((v.antigen as Obj)[k])) &&
    TEXT_KEYS.every((k) => isStr(v[k])) &&
    NUM_KEYS.every((k) => isNum(v[k])) &&
    typeof v.autoimmune === 'boolean'
  if (!ok || diff === null) return null
  const reread = measured(v.reread) === undefined ? {} : { reread: v.reread }
  const turn = isStr(v.turn) && v.turn !== '' ? { turn: v.turn } : {}
  return { ...pick(v, TEXT_KEYS), ...pick(v, NUM_KEYS), ...reread, ...turn, autoimmune: v.autoimmune, antigen: pick(v.antigen, ANTIGEN_KEYS), diff } as RepairPair
}

/** A stored list read back: only well-formed entries survive. */
export function asPairs(v: unknown): RepairPair[] {
  return Array.isArray(v) ? v.map(asPair).filter((p): p is RepairPair => p !== null && !exploration(p)) : []
}

const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Monitor'])

/**
 * A pair the rules no longer make: a shell failure with no known error on nothing it names (the
 * verifier's finding). Pods on the first 1.2 build stored four such the first afternoon; they are
 * dropped on load, as realFriction drops the retired third-edit friction.
 */
const exploration = (p: RepairPair): boolean => SHELLS.has(p.antigen.tool) && p.antigen.code === 'other' && p.antigen.target === p.antigen.tool

export type PairMemory = { key: string; count: number; sessions: number; cost: number; reread: number; last: RepairPair }

/** The one session every pair stored before turns were kept shares (1.9): unknown, never a second. */
const UNKNOWN_SESSION = '~unknown'

/** The session a pair fell in: the part of `turn` (`<sessionId>:<turnId>`) before its last colon. */
export function pairSession(p: RepairPair): string {
  if (p.turn === undefined) return UNKNOWN_SESSION
  const i = p.turn.lastIndexOf(':')
  const session = i < 0 ? '' : p.turn.slice(0, i)
  return session === '' ? UNKNOWN_SESSION : session
}

/**
 * Epitopes that recurred in TWO OR MORE SESSIONS (Bradley, 2026-10-11, "Two sessions"), dearest
 * first: by the calls' estimate plus the context their attempts re-read, which is most of what a
 * misfire costs. Several pairs in one session are recorded but are not memory: one session's
 * repeats are not a recurring procedure. Pairs stored before turns were kept have no session and
 * all share ONE unknown session, so stored memory mints again only once a new session repeats it.
 * `count` stays the distinct turns (1.8's same-turn grouping; a legacy pair counts as its own).
 * A key whose newest pair is weather (no diff) is left alone, unless one of its pairs was autoimmune.
 */
export function memory(pairs: readonly RepairPair[]): PairMemory[] {
  const groups = new Map<string, RepairPair[]>()
  for (const p of pairs) groups.set(p.key, [...(groups.get(p.key) ?? []), p])
  const out: PairMemory[] = []
  for (const [key, ps] of groups) {
    const last = ps.reduce((a, b) => (b.at >= a.at ? b : a))
    const weather = last.diff.where === 'none' && !ps.some((p) => p.autoimmune)
    const cost = ps.reduce((n, p) => n + p.cost, 0)
    const reread = ps.reduce((n, p) => n + (p.reread ?? 0), 0)
    const sessions = new Set(ps.map(pairSession)).size
    // The count shown is turns, not pairs (1.8): pairs that fell in one turn are one event.
    const turns = new Set(ps.map((p) => p.turn ?? `~${p.at}:${p.firstAt}`)).size
    if (sessions >= 2 && !weather) out.push({ key, count: turns, sessions, cost, reread, last })
  }
  return out.sort((a, b) => b.cost + b.reread - (a.cost + a.reread))
}

/** A token count as said: `850`, `12k`. */
export const tokensText = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/**
 * What the failing cost, said as an estimate to rank pairs by, never a bill: the calls' own
 * characters / 4, and the context their attempts re-read when it was measured.
 */
export function costText(cost: number, reread: number | undefined): string {
  const base = `~${tokensText(cost)} est. tokens`
  return reread === undefined || reread === 0 ? base : `${base} + ~${tokensText(reread)} context re-read`
}

function titleOf(last: RepairPair, autoimmune: boolean): { kind: Candidate['kind']; title: string } {
  const a = last.antigen
  if (autoimmune) return { kind: 'hook', title: `Retune the guard that refused ${shortTool(a.tool)} on ${a.target}` }
  if (last.diff.where === 'route') {
    return { kind: 'skill', title: `Reach ${a.target} by ${shortTool(last.cureTool)}, not ${shortTool(last.failedTool)}` }
  }
  return { kind: 'hook', title: `Check ${a.target} before sending (${a.code} ${a.kind})` }
}

/** A hook or skill proposal for each recurring epitope not already in `existing`. */
export function pairCandidates(pairs: readonly RepairPair[], existing: readonly Candidate[], at: number): Candidate[] {
  const have = new Set(existing.map((c) => c.key))
  return memory(pairs)
    .filter((g) => !have.has(`pair:${g.key}`))
    .map((g) => {
      const t = titleOf(g.last, pairs.some((p) => p.key === g.key && p.autoimmune))
      return {
        key: `pair:${g.key}`,
        kind: t.kind,
        title: cut(t.title, TITLE_MAX),
        why: cut(`${g.count} repair pairs in ${g.sessions} sessions, ${costText(g.cost, g.reread)} lost to the failed attempts`, WHY_MAX),
        evidence: cut(pairLine(g.last), EVIDENCE_MAX),
        at,
        filed: false,
      }
    })
}

function diffText(p: RepairPair): string {
  const { where, removed, added } = p.diff
  if (where === 'route') return ' - by another route'
  if (where === 'none') {
    return p.autoimmune ? ' - AUTOIMMUNE: a guard refused a call that then went through unchanged' : ' - unchanged (weather)'
  }
  const sides = [removed.length > 0 ? `removed ${removed.join(', ')}` : '', added.length > 0 ? `added ${added.join(', ')}` : '']
  const said = sides.filter((s) => s !== '').join('; ')
  return said === '' ? '' : ` - ${said}`
}

/** One pair as one line: what failed, what it cost, what cured it, and how the cure differed. */
export function pairLine(p: RepairPair): string {
  const a = p.antigen
  return `${a.code} ${a.kind} on ${a.target}: ${p.failures} failed (${costText(p.cost, p.reread)}), cured by ${shortTool(p.cureTool)}${diffText(p)}`
}

// The Barnacles pane's two-line row (1.11.2, Bradley: the pane was "borderline unreadable since
// it's a flat full box of text"). pairLine stays the one-line form for the print and the evidence.

/** Most characters of a cure's description in the pane, so a long diff wraps to two lines at most. */
const CURE_MAX = 140

/** A target short enough to read: a path's last two parts, a long hex id's first 8, a tool's name. */
export function shortTarget(target: string): string {
  if (target.includes('__')) return shortTool(target)
  if (/^[0-9a-f]{16,}$/i.test(target)) return target.slice(0, 8)
  const parts = target.split(/[\\/]+/).filter((s) => s !== '')
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/')
}

/** What failed, said once: `refused`, never `refused refused`; `other` reads as `failed`. */
function failureLabel(code: string, kind: string): string {
  const said = code === kind ? code : `${code} ${kind}`
  return said === 'other' ? 'failed' : said
}

/** The row's head: the target first, then what went wrong, with a count past one failure. */
export function pairHead(p: RepairPair): string {
  const a = p.antigen
  const count = p.failures > 1 ? ` x${p.failures}` : ''
  return `${shortTarget(a.target)} - ${failureLabel(a.code, a.kind)}${count}`
}

/** The row's second line: what cured it and how, then what the failing cost. */
export function pairCure(p: RepairPair): string {
  const how = diffText(p).replace(/^ - /, '')
  const cure = cut(`cured by ${shortTool(p.cureTool)}${how === '' ? '' : `: ${how}`}`, CURE_MAX)
  return `${cure}. Cost ${costText(p.cost, p.reread)}`
}

/** The print's repair section: the pairs cured since `since`. */
export function pairsSection(pairs: readonly RepairPair[], since: number): string[] {
  const lines = pairs.filter((p) => p.at >= since).map((p) => `- ${pairLine(p)}`)
  return ['### Repair pairs', '', ...(lines.length > 0 ? lines : ['- None this watch.'])]
}
