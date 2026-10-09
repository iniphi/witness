// The sonar (1.2): every running witness session (a pod) writes a heartbeat file and reads the
// others', so a pod knows who else is live, where two have written the same file, and where a
// /hand can go. Pure functions over plain data: no clock, no ids made here, no files read.
// Two lines are drawn here: a collision alert fires only on overlapping paths in a place the
// pods share; and a hand the person typed may start an idle pod's turn, while one a Claude
// session wrote only waits for the person's Enter (isForgedHand and touchesSonar guard that).

import type { Beat, Hand, Overlap, PodState, PodWrite } from '../types'
import { normPath } from './classify'
import { personRef } from './config'

export const BEAT_MS = 30_000
export const LIVE_MS = 120_000
export const OVERLAP_MS = 30 * 60_000
export const MAX_BEAT_WRITES = 20
export const MAX_GOALS = 3
export const GOAL_CHARS = 90
export const HAND_TEXT_MAX = 2000
/** The folders of `~/.claude` every session shares (and `CLAUDE.md` beside them). */
export const SHARED_CLAUDE_DIRS = ['rules', 'skills', 'tools', 'agents'] as const
/** What every hand envelope starts with, and what a model's own message may never carry. */
export const HAND_TAG = '[witness hand'

const SONAR_FOLDER = '.claude/state/witness-sonar'
const SONAR_WORD = 'witness-sonar'
const PREVIEW_CHARS = 80
const MIN_ID_PREFIX = 4
const STATES: readonly string[] = ['working', 'idle', 'ended']

const slashed = (s: string): string => s.replace(/\\/g, '/')
/** A drive-letter or rooted path, as the ledger normalises it. */
const ABSOLUTE = /^(?:[a-z]:\/|\/)/i
/** The project key's rule: forward slashes, no trailing slash, lower-case. */
const lower = (s: string): string => slashed(s).replace(/\/+$/, '').toLowerCase()
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 3)}...`)
const byNewest = <T extends { at: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => b.at - a.at)
const under = (path: string, dir: string): boolean => dir !== '' && path.startsWith(`${dir}/`)
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function parseJson(text: string): Record<string, unknown> | null {
  let v: unknown = null
  try {
    v = JSON.parse(text)
  } catch {
    v = null // not JSON: every caller refuses it
  }
  return isObj(v) ? v : null
}

/** `<home>/.claude/state/witness-sonar`; null when the home is unknown. */
export function sonarDir(home: string | undefined): string | null {
  const h = slashed((home ?? '').trim()).replace(/\/+$/, '')
  return h === '' ? null : `${h}/${SONAR_FOLDER}`
}

export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_')

/** The UTC day, `YYYY-MM-DD`. */
export function dayOf(at: number): string {
  const t = Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? at : 0
  return new Date(t).toISOString().slice(0, 10)
}

/** The folder is the day of the BEAT, so a live session always has a fresh file in today's folder. */
export const beatPath = (dir: string, at: number, sessionId: string): string =>
  `${dir}/${dayOf(at)}/${safeId(sessionId)}.json`

/** The days a sweep reads: today and yesterday, UTC. */
export const beatDays = (now: number): string[] => [dayOf(now), dayOf(now - 86_400_000)]

export const handsDir = (dir: string, to: string): string => `${dir}/hands/${safeId(to)}`
export const handPath = (dir: string, to: string, id: string): string => `${handsDir(dir, to)}/${safeId(id)}.json`

const cleanGoals = (goals: readonly string[]): string[] =>
  goals
    .map(oneLine)
    .filter((g) => g !== '')
    .slice(0, MAX_GOALS)
    .map((g) => cut(g, GOAL_CHARS))

const lastSegment = (path: string): string => slashed(path).replace(/\/+$/, '').split('/').pop() ?? ''

export function makeBeat(o: {
  sessionId: string
  cwd: string
  root: string | null
  startedAt: number
  now: number
  state: PodState
  goals: readonly string[]
  asks: string
  writes: readonly PodWrite[]
  notion?: readonly PodWrite[]
  tables?: readonly PodWrite[]
}): Beat {
  const root = o.root === null ? '' : lower(o.root)
  // The Notion pages and tables written (1.2, ruled 2026-10-09): additive fields on version 1.
  const more = {
    ...(o.notion === undefined ? {} : { notion: o.notion.slice(0, MAX_BEAT_WRITES).map((w) => ({ path: w.path, at: w.at })) }),
    ...(o.tables === undefined ? {} : { tables: o.tables.slice(0, MAX_BEAT_WRITES).map((w) => ({ path: w.path, at: w.at })) }),
  }
  return {
    ...more,
    format: 'witness-sonar',
    version: 1,
    sessionId: o.sessionId,
    repo: lower(o.cwd),
    root: root === '' ? null : root,
    name: lastSegment(o.cwd),
    startedAt: o.startedAt,
    beatAt: o.now,
    state: o.state,
    goals: cleanGoals(o.goals),
    asks: o.asks,
    writes: o.writes.slice(0, MAX_BEAT_WRITES).map((w) => ({ path: w.path, at: w.at })),
  }
}

export const beatFile = (b: Beat): string => JSON.stringify(b)

function podWrites(raw: unknown): PodWrite[] {
  if (!Array.isArray(raw)) return []
  const out: PodWrite[] = []
  for (const w of raw as unknown[]) {
    if (isObj(w) && typeof w.path === 'string' && w.path !== '' && isNum(w.at)) out.push({ path: w.path, at: w.at })
    if (out.length === MAX_BEAT_WRITES) break
  }
  return out
}

/**
 * A heartbeat file as another session wrote it: unknown fields dropped, malformed goals and
 * writes filtered, counts bounded; null on anything untrustworthy. A higher version is refused.
 */
export function parseBeat(text: string): Beat | null {
  const j = parseJson(text)
  if (j === null || j.format !== 'witness-sonar' || j.version !== 1) return null
  const { sessionId, startedAt, beatAt, state } = j
  if (typeof sessionId !== 'string' || sessionId === '') return null
  if (!isNum(startedAt) || !isNum(beatAt) || typeof state !== 'string' || !STATES.includes(state)) return null
  const goals = Array.isArray(j.goals) ? (j.goals as unknown[]).filter((g): g is string => typeof g === 'string') : []
  const more = {
    ...(Array.isArray(j.notion) ? { notion: podWrites(j.notion) } : {}),
    ...(Array.isArray(j.tables) ? { tables: podWrites(j.tables) } : {}),
  }
  return {
    ...more,
    format: 'witness-sonar',
    version: 1,
    sessionId,
    repo: str(j.repo),
    root: typeof j.root === 'string' ? j.root : null,
    name: str(j.name),
    startedAt,
    beatAt,
    state: state as PodState,
    goals: cleanGoals(goals),
    asks: str(j.asks),
    writes: podWrites(j.writes),
  }
}

/**
 * The file writes worth putting in a beat: files only, no wildcard (a test run's `*`), inside
 * the overlap window, one per path at its newest time, newest first.
 */
export function recentWrites(writes: ReadonlyArray<{ kind: string; target: string; at: number }>, now: number): PodWrite[] {
  const newest = new Map<string, number>()
  for (const w of writes) {
    // Absolute paths only: a shell write is read best-effort, and `$out` or `$sp/hooks` (seen in
    // the first live beat, S170) names a variable, not a file another pod could also write.
    if (w.kind !== 'file' || !ABSOLUTE.test(w.target) || w.target.includes('*') || w.target.includes('$')) continue
    if (!Number.isFinite(w.at) || w.at < now - OVERLAP_MS) continue
    const seen = newest.get(w.target)
    if (seen === undefined || w.at > seen) newest.set(w.target, w.at)
  }
  return byNewest([...newest].map(([path, at]) => ({ path, at }))).slice(0, MAX_BEAT_WRITES)
}

const podOrder = (a: Beat, b: Beat): number => {
  const [an, bn] = [a.name.toLowerCase(), b.name.toLowerCase()]
  if (an !== bn) return an < bn ? -1 : 1
  if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
}

/**
 * The other pods that are live. Each session's newest beat decides (an `ended` beat is not
 * undone by an older `working` one); then stale, ended and own beats drop. Sorted by name.
 */
export function livePods(beats: readonly Beat[], o: { now: number; self: string }): Beat[] {
  const newest = new Map<string, Beat>()
  for (const b of beats) {
    const seen = newest.get(b.sessionId)
    if (seen === undefined || b.beatAt > seen.beatAt) newest.set(b.sessionId, b)
  }
  return [...newest.values()]
    .filter((b) => b.beatAt >= o.now - LIVE_MS && b.state !== 'ended' && b.sessionId !== o.self)
    .sort(podOrder)
}

/** Whether two pods can both reach `path`: inside either repo, or a shared `~/.claude` place. */
export function sharedPlace(path: string, roots: ReadonlyArray<string | null>, home: string | null): boolean {
  const p = normPath(path)
  if (roots.some((r) => r !== null && under(p, normPath(r)))) return true
  const h = home === null ? '' : normPath(home)
  if (h === '') return false
  return p === `${h}/.claude/claude.md` || SHARED_CLAUDE_DIRS.some((d) => under(p, `${h}/.claude/${d}`))
}

function newestByPath(writes: readonly PodWrite[], floor: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of writes) {
    const k = normPath(w.path)
    if (w.at >= floor && w.at > (out.get(k) ?? Number.NEGATIVE_INFINITY)) out.set(k, w.at)
  }
  return out
}

/** The files this pod and another both wrote lately, in a place they share; one per path and peer. */
export function overlaps(o: {
  mine: readonly PodWrite[]
  myRoot: string | null
  pods: readonly Beat[]
  home: string | null
  now: number
}): Overlap[] {
  const floor = o.now - OVERLAP_MS
  const mine = o.mine.filter((w) => w.at >= floor)
  const found = new Map<string, Overlap>()
  for (const pod of o.pods) {
    const theirs = newestByPath(pod.writes, floor)
    for (const m of mine) {
      const key = normPath(m.path)
      const theirAt = theirs.get(key)
      if (theirAt === undefined || !sharedPlace(m.path, [o.myRoot, pod.root], o.home)) continue
      const id = `${key}\u0000${pod.sessionId}`
      const at = Math.max(m.at, theirAt)
      if (at > (found.get(id)?.at ?? Number.NEGATIVE_INFINITY)) found.set(id, { path: m.path, peer: pod.sessionId, peerName: pod.name, at })
    }
  }
  return byNewest([...found.values()])
}

const overlapKey = (o: Overlap): string => `${o.kind ?? 'file'}\u0000${o.path}\u0000${o.peer}`

/** The overlaps in `next` that `prev` did not already hold, so each is announced once. */
export function freshOverlaps(prev: readonly Overlap[], next: readonly Overlap[]): Overlap[] {
  const known = new Set(prev.map(overlapKey))
  return next.filter((o) => !known.has(overlapKey(o)))
}

/** The live pods in this repo (case ignored) that this pod has not met yet. */
export function newcomers(known: readonly string[], pods: readonly Beat[], myRepo: string): Beat[] {
  const repo = myRepo.toLowerCase()
  return pods.filter((b) => b.repo.toLowerCase() === repo && !known.includes(b.sessionId))
}

export const podLabel = (b: Beat): string => `${b.name} ${b.sessionId.slice(0, 4)}`

/** A pod by its 1-based row number, a session id prefix (4 or more characters), or a name prefix. */
export function findPod(pods: readonly Beat[], ref: string): Beat | 'ambiguous' | null {
  const r = ref.trim().toLowerCase()
  if (r === '') return null
  // A row number is one or two digits; a longer all-digit ref is an id prefix (the label shows four).
  if (/^\d{1,2}$/.test(r)) return pods[Number(r) - 1] ?? null
  const byId = r.length >= MIN_ID_PREFIX ? pods.filter((p) => p.sessionId.toLowerCase().startsWith(r)) : []
  const hits = byId.length > 0 ? byId : pods.filter((p) => p.name.toLowerCase().startsWith(r))
  return hits.length > 1 ? 'ambiguous' : hits[0] ?? null
}

/** `/hand <pod> <text>`: the first word names the pod, the rest is the hand. */
export function parseHandArgs(args: string): { ref: string; text: string } | null {
  const m = /^\s*(\S+)\s+([\s\S]*?)\s*$/.exec(args)
  return m === null || m[1] === undefined || m[2] === undefined || m[2] === '' ? null : { ref: m[1], text: m[2] }
}

const HEAD = /^\[witness hand (\S+) from (\S+) (typed|claude)\] Hand from (.+?):(?: |$)/
const BLANK_LINE = /\r?\n[ \t]*\r?\n/

/**
 * What goes over the wire. Line one reads on its own (the receiving person sees only that line
 * as a preview); the text follows a blank line. Ids are made path-safe so line one parses back.
 */
export function handEnvelope(h: Hand): string {
  const text = h.text.trim()
  const preview = (text.split(/\r?\n/)[0] ?? '').trim().slice(0, PREVIEW_CHARS)
  const who = `${safeId(h.id)} from ${safeId(h.from)} ${h.typed ? 'typed' : 'claude'}`
  return `${HAND_TAG} ${who}] Hand from ${oneLine(h.fromName)}: ${preview}\n\n${text.slice(0, HAND_TEXT_MAX)}`
}

/** The inverse of handEnvelope; `at` is when it was received. Null when it is not one. */
/** Where a delivery says it came from, for the person: `peer/witness`, `peer`, `no origin`. */
export function originLabel(origin: unknown): string {
  if (!isObj(origin)) return 'no origin'
  const kind = typeof origin.kind === 'string' && origin.kind !== '' ? origin.kind : 'unknown'
  return typeof origin.plugin === 'string' && origin.plugin !== '' ? `${kind}/${origin.plugin}` : kind
}

/**
 * A delivery that carries the hand tag or a witness stamp but cannot be read as a witness hand
 * (F8, 2026-10-09: live, one reached the receiving model as an ordinary message). Never typed:
 * it only fills an empty box and waits for the person, so nothing hand-shaped reaches a model
 * by itself. Its raw text is kept, so the person sees what actually arrived.
 */
export function unreadHand(text: string, origin: string, at: number): Hand {
  return { id: `unread-${at}-${text.length}`, from: '', fromName: `an unread delivery (${origin})`, typed: false, text: text.slice(0, HAND_TEXT_MAX), at }
}

/**
 * The engine hands session.receive the body as the model would read it: inside one
 * `<cross-session-message ...>` wrapper (seen live 2026-10-09, pod 33a9). That one wrapper is
 * taken off; anything else is returned as it came.
 */
const WRAPPER = /^<cross-session-message\b[^>]*>\r?\n([\s\S]*)\r?\n<\/cross-session-message>$/
export function unwrapDelivery(text: string): string {
  const t = text.trim()
  const m = WRAPPER.exec(t)
  return m === null ? text : (m[1] ?? '')
}

export function parseHand(delivered: string, at: number): Hand | null {
  const text = unwrapDelivery(delivered)
  if (!text.startsWith(HAND_TAG)) return null
  const lineEnd = text.search(/\r?\n/)
  const head = lineEnd < 0 ? null : HEAD.exec(text.slice(0, lineEnd))
  const blank = BLANK_LINE.exec(text)
  if (head === null || blank === null) return null
  const body = text.slice(blank.index + blank[0].length).trim()
  const [, id, from, how, fromName] = head
  if (body === '' || id === undefined || from === undefined || fromName === undefined) return null
  return { id, from, fromName, typed: how === 'typed', text: body, at }
}

/** True only for a message the witness plugin sent to this session as a peer. */
export const isWitnessHand = (origin: unknown): boolean => isObj(origin) && origin.kind === 'peer' && origin.plugin === 'witness'

/** A model's own SendMessage may never carry a witness envelope: that is a forged hand. */
export const isForgedHand = (o: { originKind: string; text: string }): boolean =>
  o.originKind === 'model' && o.text.includes(HAND_TAG)

/**
 * What a hand does to the receiving pod: only one the person typed starts a turn; one a Claude
 * session wrote fills an empty prompt box and waits for Enter; never over a draft or unattended.
 */
export function handAction(o: { typed: boolean; interactive: boolean; boxEmpty: boolean; typedStarts: boolean }): 'submit' | 'fill' | 'wait' {
  if (!o.interactive) return 'wait'
  // A typed hand starts work only where typed hands may (ruled 2026-10-09); otherwise it waits like any other.
  if (o.typed && o.typedStarts) return 'submit'
  return o.boxEmpty ? 'fill' : 'wait'
}

/** The prompt text the receiving pod's model reads, saying plainly who vouches for the hand. */
export function handPrompt(h: Hand, person: string): string {
  const how = h.typed ? `${personRef(person)} typed it there` : 'a Claude session wrote it; read it, then press Enter to take it on'
  return `Hand from ${h.fromName} (${how}):\n\n${h.text}`
}

/** The file fallback when a send was not delivered. */
export function handFile(h: Hand, to: string, taken: boolean): string {
  const { id, from, fromName, typed, text, at } = h
  return JSON.stringify({ format: 'witness-hand', version: 1, to, taken, hand: { id, from, fromName, typed, text, at } })
}

export function parseHandFile(text: string): { hand: Hand; to: string; taken: boolean } | null {
  const j = parseJson(text)
  if (j === null || j.format !== 'witness-hand' || j.version !== 1) return null
  const h = j.hand
  if (!isObj(h) || typeof j.to !== 'string') return null
  const { id, from, fromName, typed, at } = h
  const body = h.text
  if (typeof id !== 'string' || id === '' || typeof from !== 'string' || typeof fromName !== 'string') return null
  if (typeof typed !== 'boolean' || typeof body !== 'string' || body.trim() === '' || !isNum(at)) return null
  return { hand: { id, from, fromName, typed, text: body.slice(0, HAND_TEXT_MAX), at }, to: j.to, taken: j.taken === true }
}

const FILE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
// Monitor runs a shell command too (the blind verifier's finding, S170).
const SHELL_TOOLS: readonly string[] = ['Bash', 'PowerShell', 'Monitor']

/** A path with its `.` and `..` segments folded in, so `witness-usage/../witness-sonar` cannot hide. */
function folded(path: string): string {
  const out: string[] = []
  for (const seg of normPath(path).split('/')) {
    if (seg === '..') {
      if (out.length > 1) out.pop()
    } else if (seg !== '.') out.push(seg)
  }
  return out.join('/')
}

/**
 * Whether a tool call writes into the sonar folder. A model that could write there could forge
 * a hand the person typed, so the caller refuses such a call. A file tool is caught by its
 * folded path; a shell command by any mention of the folder's name.
 */
export function touchesSonar(tool: string, input: unknown, dir: string | null): boolean {
  if (dir === null || !isObj(input)) return false
  if (SHELL_TOOLS.includes(tool)) return typeof input.command === 'string' && slashed(input.command).toLowerCase().includes(SONAR_WORD)
  if (!FILE_TOOLS.includes(tool)) return false
  const root = normPath(dir)
  return [input.file_path, input.notebook_path].some((p) => {
    if (typeof p !== 'string') return false
    const f = folded(p)
    return under(f, root) || f.split('/').includes(SONAR_WORD)
  })
}
