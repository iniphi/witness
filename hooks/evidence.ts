// The confirm channel (Bradley, S162): Claude tells the companion an ask is done,
// and the companion believes it only on evidence it checks itself. A citation is a
// tool call the companion observed in this session - a piece of its input, and
// words found in its OUTPUT but not in its input, so a command cannot manufacture
// its own proof (an `echo "verified"` cites itself and fails) - or words Bradley
// typed himself, for what only he can witness, such as a layout. Pure.

import type { Ask, AskWitness, Heard, Observed } from '../types'
import { cleanText, isSessionAsk, restates } from './asks'
import { DEFAULT_PERSON, onWords, personRef } from './config'

export const CONFIRM_TOOL = 'mcp__witness__confirm'
/**
 * Calls kept as evidence. 200 ran out in one long turn (S163): the read-back an early
 * ask rested on had aged out before the work was confirmed. Each entry is bounded
 * (INPUT_CAP + RESULT_HEAD + RESULT_TAIL), so 600 is at most a few MB.
 */
export const OBSERVED_CAP = 600
export const HEARD_CAP = 50
/** The head and tail of a result are kept: a test run's verdict is at its end. */
export const RESULT_HEAD = 1_500
export const RESULT_TAIL = 2_500
export const INPUT_CAP = 2_000
export const MIN_EXCERPT = 6
export const MIN_COMMAND = 3

export type Evidence =
  | { source: 'call'; command: string; excerpt: string }
  | { source: 'user'; excerpt: string }

/** `outcome: 'dropped'` (0.6.2, a field report): the user called the ask off; absent means done. */
export type ConfirmItem = { ask: string; evidence: Evidence[]; outcome?: 'dropped' }

export type Verdict = {
  ask: string
  askId: string | null
  ok: boolean
  reason: string
  refs: string[]
  dropped?: boolean
}

const INPUT_KEYS = ['command', 'query', 'file_path', 'path', 'pattern', 'id', 'page_id', 'url', 'name']

/** A tool call's input as text: its command, query or path, else the whole input as JSON. */
export function inputText(input: Readonly<Record<string, unknown>>): string {
  const picked = INPUT_KEYS.map(k => input[k]).filter((v): v is string => typeof v === 'string')
  const text = picked.length > 0 ? picked.join(' ') : JSON.stringify(input)
  return text.slice(0, INPUT_CAP)
}

export function trimResult(text: string): string {
  if (text.length <= RESULT_HEAD + RESULT_TAIL) return text
  return `${text.slice(0, RESULT_HEAD)}\n...\n${text.slice(-RESULT_TAIL)}`
}

/** Tools whose result is a subagent's report, or its launch notice (1.1). */
export const REPORT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'TaskOutput', 'Workflow'])

/**
 * A call whose output may never be cited (1.1, ruled 2026-10-09): a subagent's own call,
 * or an Agent, Task, TaskOutput or Workflow result (a Workflow's result relays its agents'
 * reports). A report is a claim the main session reads
 * back, never the read-back itself.
 */
export function isReport(o: Pick<Observed, 'tool' | 'agent'>): boolean {
  return o.agent || REPORT_TOOLS.has(o.tool)
}

/**
 * Appends one observed call, newest kept. Never the confirm tool's own, and never a
 * subagent's (1.1): nothing a subagent ran is evidence, so it would only push the main
 * loop's read-backs out of the window.
 */
export function observe(log: readonly Observed[], o: Observed): Observed[] {
  if (o.tool === CONFIRM_TOOL || o.agent) return [...log]
  const kept: Observed = { ...o, input: o.input.slice(0, INPUT_CAP), result: trimResult(o.result) }
  return [...log, kept].slice(-OBSERVED_CAP)
}

export function hear(log: readonly Heard[], h: Heard): Heard[] {
  return [...log, h].slice(-HEARD_CAP)
}

const norm = (s: string): string => cleanText(s).toLowerCase()

/**
 * Text as the model read it: an MCP result arrives JSON-encoded inside the tool-result
 * envelope, so its quotes are stored as \" or \\\" (two or three escapes deep; one level
 * was not enough, seen live in S163) and a quoted excerpt would never match. Any run of
 * backslashes before a quote or an n is undone. Applied to input and output alike, so the
 * input-must-not-contain-the-excerpt rule still binds.
 */
const unescaped = (s: string): string => s.replace(/\\+"/g, '"').replace(/\\+n/g, ' ')

/** Does `text` contain `excerpt`, as stored or with its JSON-escaped quotes undone? */
const holds = (text: string, excerpt: string): boolean =>
  norm(text).includes(excerpt) || norm(unescaped(text)).includes(excerpt)

/** The ref of the observed call or heard prompt that bears this evidence out, made after `since`; else null. */
export function bearsOut(e: Evidence, observed: readonly Observed[], heard: readonly Heard[], since: number): string | null {
  const excerpt = norm(e.excerpt)
  if (excerpt.length < MIN_EXCERPT) return null
  if (e.source === 'user') {
    const h = heard.find(x => x.at >= since && norm(x.text).includes(excerpt))
    return h === undefined ? null : `user@${h.at}`
  }
  const command = norm(e.command)
  if (command.length < MIN_COMMAND) return null
  const o = observed.find(
    x =>
      x.at >= since &&
      !x.isError &&
      x.tool !== CONFIRM_TOOL &&
      !isReport(x) &&
      holds(x.input, command) &&
      holds(x.result, excerpt) &&
      !holds(x.input, excerpt),
  )
  return o === undefined ? null : o.toolUseId
}

/** An ask by id, else by its text (exact, then a unique containment either way), ignoring dropped asks. */
export function findAsk(asks: readonly Ask[], key: string): Ask | null {
  const live = asks.filter(a => a.state !== 'dropped')
  const byId = live.find(a => a.id === key)
  if (byId) return byId
  const k = norm(key)
  if (k.length === 0) return null
  const exact = live.find(a => norm(a.text) === k)
  if (exact) return exact
  const near = live.filter(a => norm(a.text).includes(k) || k.includes(norm(a.text)))
  if (near.length > 0) return near.length === 1 ? (near[0] ?? null) : null
  // A close paraphrase, when one live ask clearly wins (a field report: five of five
  // free-text confirms missed and needed a second call). A tie at the top is never guessed.
  const scored = live.flatMap(a => {
    const share = restates(a.text, key)
    return share === null ? [] : [{ a, share }]
  })
  const top = Math.max(0, ...scored.map(x => x.share))
  const best = scored.filter(x => x.share === top)
  return best.length === 1 ? (best[0]?.a ?? null) : null
}

function judge(item: ConfirmItem, ask: Ask, observed: readonly Observed[], heard: readonly Heard[], person: string): Verdict {
  const base = { ask: item.ask, askId: ask.id, refs: [] as string[] }
  if (ask.state === 'witnessed') return { ...base, ok: true, reason: 'already witnessed' }
  if (item.evidence.length === 0) return { ...base, ok: false, reason: 'no evidence cited' }
  // A drop rests on the user alone: the model may not call off an ask on its own say.
  if (item.outcome === 'dropped' && !item.evidence.some(e => e.source === 'user')) {
    return { ...base, ok: false, reason: `a drop needs ${personRef(person)}'s own words calling the ask off (source user)` }
  }
  const refs = item.evidence.map(e => bearsOut(e, observed, heard, ask.at))
  const missing = refs.findIndex(r => r === null)
  if (missing !== -1) {
    const e = item.evidence[missing]
    const why =
      e?.source === 'user'
        ? `those words are not in any of ${personRef(person)}'s prompts since the ask was raised`
        : 'no call since the ask was raised has that input with that excerpt in its output (and not in its input)'
    return { ...base, ok: false, reason: `evidence ${missing + 1} did not check out: ${why}` }
  }
  const proved = refs.filter((r): r is string => r !== null)
  if (item.outcome === 'dropped') return { ...base, ok: true, reason: `called off ${onWords(person)}`, refs: proved, dropped: true }
  return { ...base, ok: true, reason: 'witnessed', refs: proved }
}

/** Checks every item; an ask whose every citation checks out becomes witnessed. */
export function confirmAsks(
  asks: readonly Ask[],
  items: readonly ConfirmItem[],
  observed: readonly Observed[],
  heard: readonly Heard[],
  now: number,
  person: string = DEFAULT_PERSON,
): { asks: Ask[]; verdicts: Verdict[] } {
  const verdicts: Verdict[] = items.map(item => {
    const ask = findAsk(asks, item.ask)
    if (ask === null) return { ask: item.ask, askId: null, ok: false, reason: 'no single live ask matches that', refs: [] }
    return judge(item, ask, observed, heard, person)
  })
  const passed = new Map(verdicts.filter(v => v.ok && v.askId !== null && v.refs.length > 0).map(v => [v.askId, v]))
  const next = asks.map((a): Ask => {
    const v = passed.get(a.id)
    if (v === undefined) return { ...a }
    if (v.dropped) return { ...a, state: 'dropped', calledOff: { refs: v.refs, at: now } }
    const by: AskWitness['by'] = v.refs.some(r => r.startsWith('user@')) ? 'user' : 'evidence'
    return { ...a, state: 'witnessed', witness: { by, refs: v.refs, at: now } }
  })
  return { asks: next, verdicts }
}

/** Parses the tool's input defensively; anything malformed is dropped, never thrown. */
export function parseItems(input: unknown): ConfirmItem[] {
  const raw = (input as { items?: unknown })?.items
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    const ask = (item as { ask?: unknown })?.ask
    const ev = (item as { evidence?: unknown })?.evidence
    if (typeof ask !== 'string' || !Array.isArray(ev)) return []
    const evidence = ev.flatMap((e): Evidence[] => {
      const x = e as { source?: unknown; command?: unknown; excerpt?: unknown }
      if (typeof x?.excerpt !== 'string') return []
      if (x.source === 'user') return [{ source: 'user', excerpt: x.excerpt }]
      if (x.source === 'call' && typeof x.command === 'string') return [{ source: 'call', command: x.command, excerpt: x.excerpt }]
      return []
    })
    const dropped = (item as { outcome?: unknown })?.outcome === 'dropped'
    return [dropped ? { ask, outcome: 'dropped' as const, evidence } : { ask, evidence }]
  })
}

/** The tool's answer to the model: one line per item, then the asks still undone with their ids. */
export function confirmReport(verdicts: readonly Verdict[], asks: readonly Ask[], closeName = '/close'): string {
  const head = (v: Verdict) => (!v.ok ? 'NOT WITNESSED' : v.dropped ? 'DROPPED' : 'WITNESSED')
  const lines = verdicts.map(v => `${head(v)} - ${v.ask}: ${v.reason}`)
  // A build is held for /close, never listed as this session's undone work (0.6.0), and a
  // carried ask is the last watch's, listed apart so it is never read as this session's.
  const undoneHere = (a: Ask) => a.settled === undefined && (a.state === 'open' || a.state === 'claimed')
  const open = asks.filter(a => isSessionAsk(a) && undoneHere(a))
  const carried = asks.filter(a => a.source === 'carried' && undoneHere(a))
  const builds = asks.filter(a => a.source === 'build' && a.state !== 'dropped').length
  const row = (a: Ask) => `  ${a.id}: ${a.text}`
  const tail =
    open.length > 0
      ? ['Still undone:', ...open.map(row)]
      : [carried.length > 0 ? 'Nothing undone this session.' : 'Nothing undone.']
  const fromLast = carried.length === 0 ? [] : ['Carried in from the last watch (not counted in asks n/m):', ...carried.map(row)]
  const held = builds === 0 ? [] : [`(${builds} build${builds === 1 ? '' : 's'} held for ${closeName}, to become to-dos)`]
  return [...lines, ...tail, ...fromLast, ...held].join('\n')
}

/** The confirm tool's input schema, naming the person as the model reads it. */
export function confirmSchema(person: string): Record<string, unknown> {
  const who = personRef(person)
  return {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ask: { type: 'string', description: 'The ask id, or its text as /undone shows it.' },
          outcome: {
            type: 'string',
            enum: ['done', 'dropped'],
            description:
              `done (the default): the work is done, cite read-backs. dropped: ${who} called the ask off; cite those words (source user), the only evidence a drop takes.`,
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', enum: ['call', 'user'] },
                command: {
                  type: 'string',
                  description: 'source call: a piece of the input of a tool call made in this session (the Bash command, the SQL, the path).',
                },
                excerpt: {
                  type: 'string',
                  description: `call: words from that call's OUTPUT that are not in its input. user: words ${who} typed in one of their prompts.`,
                },
              },
              required: ['source', 'excerpt'],
            },
          },
        },
        required: ['ask', 'evidence'],
      },
    },
  },
  required: ['items'],
  }
}

export const CONFIRM_SCHEMA: Record<string, unknown> = confirmSchema(DEFAULT_PERSON)

/** The confirm tool's description, naming the person as the model reads it. */
export function confirmDescription(person: string): string {
  const who = personRef(person)
  return (
  'Tell the witness companion that undone asks are done, with evidence it checks itself. ' +
  'Confirm an ask in the same turn as its read-back, before calling it done: a later bulk confirm redoes the read-backs. ' +
  'For each ask cite evidence from a read-back made AFTER the ask was raised: ' +
  '{source:"call", command:<a piece of a tool call\'s input from this session>, excerpt:<words in that call\'s output, not in its input>}, ' +
  `or, for what only ${who} can witness (a layout), {source:"user", excerpt:<words ${who} typed>}. ` +
  `Only the first ${RESULT_HEAD} and last ${RESULT_TAIL} characters of an output are kept, ` +
  'so cite a short read-back (a grep or narrow query of the passage), never the middle of a long one. ' +
  'Every citation must check out or the ask stays undone; a claim is not evidence, ' +
  "nor is a subagent's report or its own calls (an Agent, Task or TaskOutput result): read back what it changed. " +
  `When ${who} called an ask off, pass outcome "dropped" with those words as {source:"user"} evidence: ` +
  'the ask is then neither done nor undone, and never carried. Never drop an ask on your own judgement.'
  )
}

export const CONFIRM_DESCRIPTION = confirmDescription(DEFAULT_PERSON)

/** Most asks one note names; the rest wait for the next. */
export const NOTE_MAX_ASKS = 5

/**
 * The one line put to Claude on Bradley's next prompt when a turn ended with asks it
 * called done but never proved (Bradley, S165, option B): about 40 tokens, once per ask,
 * against a /tackle sweep that redoes the read-backs later.
 */
export function unprovedNote(asks: ReadonlyArray<{ id: string; text: string }>): string {
  // Each with its id, so one confirm call closes it (a field report: the model cannot run /undone).
  const list = asks
    .slice(0, NOTE_MAX_ASKS)
    .map(a => `${a.id}: "${a.text}"`)
    .join('; ')
  return `witness: claimed done but not proved by a read-back: ${list}. Read each back and confirm it with ${CONFIRM_TOOL} in this turn, citing the id.`
}
