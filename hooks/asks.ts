// The asks ledger: Bradley's done/undone tracker. Pure functions over plain data.
// An ask counts as done only when witnessed; a claimed-but-unwitnessed ask is pale.
import type { Ask, Ledger } from '../types'

/** `dropped`: a `- [-]` line, a goal the session set aside. */
export type Goal = { text: string; ticked: boolean; dropped?: boolean }
/**
 * done/total/pale count this session's asks only; `carried` the undone carried in from the
 * last watch; `builds` the live multi-session builds.
 */
export type Counts = { done: number; total: number; pale: number; carried: number; builds: number }
export type Extraction = { asks: string[]; builds: string[] }
export type PaneRow = { id: string; marker: '[ ]' | '[~]' | '[x]'; text: string; source: Ask['source']; settled?: Ask['settled'] }

export const MAX_ASK_CHARS = 90
export const MAX_EXTRACT = 5
export const MAX_BUILDS = 3
/** How much of the previous answer's end the extract pass reads beside an approval. */
export const MAX_PREVIOUS_CHARS = 800
export const MAX_CARRIED = 30
export const MAX_PROMPT_ASKS = 40
export const PRINT_END = '<!-- /witness print -->'

/** Every whitespace run (newlines included) becomes one space: no ask can inject a markdown line. */
export function cleanText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** The n newest entries (by `at`, later index wins a tie), kept in original order with original indices. */
function newestEntries(asks: Ask[], n: number): Array<{ a: Ask; i: number }> {
  const all = asks.map((a, i) => ({ a, i }))
  if (all.length <= n) return all
  const keep = [...all].sort((x, y) => y.a.at - x.a.at || y.i - x.i).slice(0, n)
  return keep.sort((x, y) => x.i - y.i)
}

/** Lower-case, links and punctuation stripped, first 60 chars: the dedupe key. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
}

/** First balanced {...} object in the text that parses as JSON; null on anything else. */
export function parseJsonObject(reply: string): Record<string, unknown> | null {
  if (typeof reply !== 'string') return null
  const text = reply.replace(/```[a-zA-Z]*/g, ' ')
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = balancedEnd(text, start)
    if (end === -1) continue
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1))
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
      }
    } catch {
      // try the next opening brace
    }
  }
  return null
}

function balancedEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * `- [ ]` / `- [x]` / `- [-]` items under the goals heading (config `goalsHeading`,
 * default `## Goals`), up to the next heading of the same level.
 */
export function parseGoals(markdown: string, heading = '## Goals'): Goal[] {
  const h = /^(#+)\s+(.*\S)\s*$/.exec(heading.trim())
  const level = h?.[1]?.length ?? 2
  const title = (h?.[2] ?? 'Goals').toLowerCase()
  const goals: Goal[] = []
  let inGoals = false
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const hd = /^(#+)\s+(.*?)\s*$/.exec(line)
    if (hd !== null && hd[1]?.length === level) {
      inGoals = (hd[2] ?? '').toLowerCase() === title
      continue
    }
    if (!inGoals) continue
    const m = /^\s*[-*]\s+\[( |x|X|-)\]\s+(.*\S)\s*$/.exec(line)
    if (m) goals.push({ text: (m[2] ?? '').trim(), ticked: m[1] === 'x' || m[1] === 'X', dropped: m[1] === '-' })
  }
  return goals
}

/** Shortest dedupe key a goal edit may extend and still be the same goal. */
const MIN_EDIT_KEY = 12

/**
 * The live ask a goal names: the same key, else (for a goal-sourced ask only) a key one
 * extends, as when an outcome is appended to the line in place. Each ask matches once.
 */
function goalMatch(asks: Ask[], key: string, taken: ReadonlySet<string>): number {
  const live = (a: Ask) => a.state !== 'dropped' && !taken.has(a.id)
  const same = asks.findIndex((a) => live(a) && normalise(a.text) === key)
  if (same !== -1) return same
  return asks.findIndex((a) => {
    if (!live(a) || a.source !== 'goal') return false
    const old = normalise(a.text)
    const short = old.length < key.length ? old : key
    return short.length >= MIN_EDIT_KEY && (key.startsWith(old) || old.startsWith(key))
  })
}

const STOP_WORDS = new Set(
  'the a an to of and or in on for with that this it its be is are was us we our my me as at by from so then than into up out about can could should would will just also please'.split(' '),
)

/** A word's plain form: a trailing plural `s`, or `ing` / `ed` on a longer word, cut. */
function stem(w: string): string {
  if (w.length > 5 && /(ing|ed)$/.test(w)) return w.replace(/(ing|ed)$/, '')
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  return new Set(words.map(stem))
}

/** Shared content words a restatement needs, and their share of the shorter text. */
export const RESTATE_SHARED = 3
export const RESTATE_SHARE = 0.6

/** Content words two texts share, and their share of the shorter text's words. */
export function wordOverlap(a: string, b: string): { shared: number; share: number } {
  const wa = contentWords(a)
  const wb = contentWords(b)
  const shared = [...wa].filter((w) => wb.has(w)).length
  return { shared, share: shared / Math.max(1, Math.min(wa.size, wb.size)) }
}

/** Is `b` close enough to `a` to be the same request in other words? */
export function restates(a: string, b: string): number | null {
  const o = wordOverlap(a, b)
  return o.shared >= RESTATE_SHARED && o.share >= RESTATE_SHARE ? o.share : null
}

/**
 * The typed ask a goal restates (a field report: /start wrote Goals rephrasing Bradley's
 * prompt, and each request counted twice). Most shared content words wins; -1 when none qualifies.
 */
function restatedAsk(asks: Ask[], text: string, taken: ReadonlySet<string>): number {
  let best = -1
  let bestShare = 0
  asks.forEach((a, i) => {
    if (a.source !== 'ask' || a.state === 'dropped' || taken.has(a.id)) return
    const share = restates(a.text, text)
    if (share !== null && share > bestShare) {
      best = i
      bestShare = share
    }
  })
  return best
}

/**
 * The log's Goals are the session's own record, so the ledger follows them:
 * a goal rescoped in place supersedes its old ask, a `[-]` goal drops it, and a goal
 * gone from the log is dropped unless witnessed. Asks Bradley typed are never touched.
 * No goals at all changes nothing: a Goals section that vanished is not a ruling.
 */
export function mergeGoals(
  asks: Ask[],
  goals: Goal[],
  opts: { at: number; ids: string[] },
): Ask[] {
  if (goals.length === 0) return asks.map((a) => ({ ...a }))
  let next = asks.map((a) => ({ ...a }))
  const named = new Set<string>()
  let used = 0
  for (const goal of goals) {
    const text = cleanText(goal.text)
    const key = normalise(text)
    if (key === '') continue
    const matched = goalMatch(next, key, named)
    // A goal restating a typed ask takes that ask over: one request, one count.
    const restated = matched === -1 && !goal.dropped ? restatedAsk(next, text, named) : -1
    const idx = matched !== -1 ? matched : restated
    if (idx !== -1) {
      const found = next[idx]!
      named.add(found.id)
      const undone = found.state === 'open' || found.state === 'claimed'
      const patch: Partial<Ask> = goal.dropped
        ? undone
          ? { state: 'dropped' }
          : {}
        : {
            ...((found.source === 'goal' || idx === restated) && found.text !== text ? { text } : {}),
            ...(found.source === 'carried' || found.source === 'build' || idx === restated
              ? { source: 'goal' as const }
              : {}),
            ...(goal.ticked && found.state === 'open' ? { state: 'claimed' as const, claimId: null } : {}),
          }
      next = next.map((a, i) => (i === idx ? { ...a, ...patch } : a))
      continue
    }
    if (goal.dropped) continue
    const id = opts.ids[used]
    if (id === undefined) continue
    used++
    named.add(id)
    next = [
      ...next,
      {
        id,
        text,
        source: 'goal',
        state: goal.ticked ? 'claimed' : 'open',
        claimId: null,
        at: opts.at,
      },
    ]
  }
  return next.map((a) =>
    a.source === 'goal' && !named.has(a.id) && (a.state === 'open' || a.state === 'claimed')
      ? { ...a, state: 'dropped' }
      : a,
  )
}

/**
 * `previous`: the end of the assistant's last answer, so an approval ("greenlight") can be
 * read as the proposal it commissions. Only its last MAX_PREVIOUS_CHARS are
 * sent, where a proposal sits, and the section is left out when there is none.
 */
export function extractPrompt(promptText: string, asks: Ask[], previous = ''): string {
  const existing = newestEntries(
    asks.filter((a) => a.state !== 'dropped'),
    MAX_PROMPT_ASKS,
  )
    .map(({ a }, i) => `${i + 1}. ${cleanText(a.text)}`)
    .join('\n')
  const before = cleanText(previous).slice(-MAX_PREVIOUS_CHARS).trim()
  return [
    'You read one message a person sent to an AI coding assistant and list the asks in it, in two kinds.',
    'asks: things the person wants the assistant to DO and finish in this session (build, fix, add, change, write, run, check and report).',
    'builds: work the person sets for several sessions or days, a whole project, or many deliverables at once (e.g. "over the next few days", "rebuild X to a shippable standard", "build 18 apps"). Put each item in one kind only.',
    'When the message approves a concrete proposal at the end of the assistant\'s previous message ("yes", "go ahead", "greenlight", "do it"), list that proposal as an ask, in its own terms. Never list anything from the previous message that this message does not approve.',
    'Exclude: questions asking for information, questions whether something could or should be done ("can we also have X?", "would X be hard?") until the person asks for it, approvals that commission nothing, opinions, thanks, background context, any standing instruction about how to work, conditional ones included ("explain as we go", "always do X", "if you find a bug, report it"), the method steps of a plan rather than the work it does ("sweep first", "verify each item", "close each with a read-back"), anything the person quotes or pastes to talk about (another prompt, a list, a log) unless they ask for it to be done, and anything already in the existing list.',
    `Write each item as an imperative of at most ${MAX_ASK_CHARS} characters, in the person's own terms. Never add a word that changes what was asked: "build an /agile ultracode" is not "build an /agile ultracode skill".`,
    `At most ${MAX_EXTRACT} asks and ${MAX_BUILDS} builds. Use empty lists when there are none.`,
    'Output shape: {"asks": ["imperative"], "builds": ["imperative"]}',
    'Reply with the JSON only.',
    '',
    'Existing list:',
    existing === '' ? '(none)' : existing,
    ...(before === '' ? [] : ['', "The end of the assistant's previous message:", before]),
    '',
    'Message:',
    promptText,
  ].join('\n')
}

/** Clean texts from one list of the reply, skipping any key already seen; `seen` is extended. */
function takeTexts(raw: unknown, seen: Set<string>, cap: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = cleanText(item).slice(0, MAX_ASK_CHARS).trim()
    const key = normalise(text)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length === cap) break
  }
  return out
}

/** The side pass's two lists, deduped against the existing asks and across each other (asks first). */
export function parseExtraction(reply: string, asks: Ask[] = []): Extraction {
  const obj = parseJsonObject(reply)
  const seen = new Set(asks.map((a) => normalise(a.text)))
  const found = takeTexts(obj?.asks, seen, MAX_EXTRACT)
  return { asks: found, builds: takeTexts(obj?.builds, seen, MAX_BUILDS) }
}

export function parseExtract(reply: string, asks: Ask[] = []): string[] {
  return parseExtraction(reply, asks).asks
}

export function matchPrompt(openAsks: Ask[], answer: string): string {
  // Numbers stay the original 1-based positions in openAsks, so parseMatch(reply, openAsks.length) maps back.
  const list = newestEntries(openAsks, MAX_PROMPT_ASKS)
    .map(({ a, i }) => `${i + 1}. ${cleanText(a.text)}`)
    .join('\n')
  return [
    'You compare a numbered list of asks with the answer an AI assistant just gave.',
    'List the numbers of the asks the answer claims to have COMPLETED. Leave out asks it only discusses, plans, or partly does.',
    'Output shape: {"done": [1, 3]}',
    'Use {"done": []} when none. Reply with the JSON only.',
    '',
    'Asks:',
    list === '' ? '(none)' : list,
    '',
    'Answer:',
    answer,
  ].join('\n')
}

/** 1-based item numbers from the reply, in range, no duplicates. */
export function parseMatch(reply: string, n: number): number[] {
  const raw = parseJsonObject(reply)?.done
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v)) continue
    if (v < 1 || v > n || out.includes(v)) continue
    out.push(v)
  }
  return out
}

export function applyMatches(asks: Ask[], askIds: string[], claimId: string): Ask[] {
  return asks.map((a) =>
    askIds.includes(a.id) && (a.state === 'open' || a.state === 'claimed')
      ? { ...a, state: 'claimed', claimId }
      : { ...a },
  )
}

export function resolveStates(asks: Ask[], ledger: Ledger): Ask[] {
  return asks.map((ask) => {
    if (ask.state === 'dropped' || ask.state === 'witnessed') return { ...ask }
    // Only an ask's OWN claim counts; a ticked goal with no claim stays pale until applyMatches attaches one.
    const claimId = ask.claimId
    const claim = claimId === null ? undefined : ledger.claims.find((c) => c.id === claimId)
    if (claim === undefined) return { ...ask, claimId }
    return { ...ask, claimId, state: claim.state === 'developed' ? 'witnessed' : 'claimed' }
  })
}

/** This session's own work: not carried in from the last watch, not a multi-session build. */
export function isSessionAsk(a: Ask): boolean {
  return a.source !== 'carried' && a.source !== 'build'
}

/** Carried asks and builds are not Bradley's asks for this session: never in n/m. */
export function counts(asks: Ask[]): Counts {
  const live = asks.filter((a) => a.state !== 'dropped' && isSessionAsk(a))
  return {
    done: live.filter((a) => a.state === 'witnessed').length,
    total: live.length,
    pale: live.filter((a) => a.state === 'claimed').length,
    carried: asks.filter((a) => a.source === 'carried' && (a.state === 'open' || a.state === 'claimed')).length,
    builds: asks.filter((a) => a.source === 'build' && a.state !== 'dropped').length,
  }
}

export function nm(asks: Ask[]): string {
  const c = counts(asks)
  return `${c.done}/${c.total}${c.pale > 0 ? ` ~${c.pale}` : ''}`
}

const ORDER: Record<string, number> = { open: 0, claimed: 1, witnessed: 2 }
const MARKER: Record<string, PaneRow['marker']> = { open: '[ ]', claimed: '[~]', witnessed: '[x]' }

/** This session's asks first (open, pale, done), then the carried ones, then the builds, each under its own heading. */
export function paneRows(asks: Ask[]): PaneRow[] {
  const group = (a: Ask) => (a.source === 'build' ? 2 : a.source === 'carried' ? 1 : 0)
  return asks
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.state !== 'dropped')
    .sort((x, y) => group(x.a) - group(y.a) || (ORDER[x.a.state] ?? 0) - (ORDER[y.a.state] ?? 0) || x.i - y.i)
    .map(({ a }) => ({
      id: a.id,
      marker: MARKER[a.state] ?? '[ ]',
      text: a.text,
      source: a.source,
      ...(a.settled === undefined ? {} : { settled: a.settled }),
    }))
}

export function dropAsk(asks: Ask[], id: string): Ask[] {
  return asks.map((a) => (a.id === id ? { ...a, state: 'dropped' } : { ...a }))
}

/**
 * What may carry (Bradley, 2026-10-08): an open ask nobody claimed, one hop only. A pale
 * claim or a goal the log ticked stays in the print as pale and is not reopened, and a
 * carried ask still untouched at the end is not carried again.
 */
function carries(a: Ask): boolean {
  // A build is never carried: /close makes it a to-do (0.6.0); nor is what the close triage settled (0.8.0).
  return a.state === 'open' && isSessionAsk(a) && a.settled === undefined
}

export type Triage = { dismissed: string[]; todo: string[] }

/** `- dismissed: <item> - <evidence>` and `- to-do: <item> -> <url>` under `## Witness triage` (/close Step 4b). */
export function parseTriage(markdown: string): Triage {
  const dismissed: string[] = []
  const todo: string[] = []
  let inTriage = false
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      inTriage = /^##\s+Witness triage\s*$/i.test(line)
      continue
    }
    if (!inTriage) continue
    const m = /^\s*[-*]\s+(dismissed|to-do):\s*(.*\S)\s*$/i.exec(line)
    if (m) (m[1]!.toLowerCase() === 'dismissed' ? dismissed : todo).push((m[2] ?? '').trim())
  }
  return { dismissed, todo }
}

/** Does a triage line quote this ask? It opens with the ask's text (a suffix and the evidence follow). */
function quotes(line: string, a: Ask): boolean {
  const k = normalise(a.text)
  const l = normalise(line)
  return k !== '' && (l === k || (k.length >= MIN_EDIT_KEY && l.startsWith(k)))
}

/**
 * The close triage settles what it quotes (a field report: a /tackle after /close offered
 * the eight carried asks the triage had just dismissed with evidence). Dismissed: dropped.
 * To-do: routed to the board, so no longer this session's undone work. Witnessed asks and
 * anything the triage does not quote are left as they are.
 */
export function applyTriage(asks: Ask[], triage: Triage): Ask[] {
  return asks.map((a): Ask => {
    if (a.state === 'dropped' || a.state === 'witnessed' || a.settled !== undefined) return { ...a }
    if (triage.dismissed.some((l) => quotes(l, a))) return { ...a, state: 'dropped', settled: 'dismissed' }
    if (triage.todo.some((l) => quotes(l, a))) return { ...a, settled: 'to-do' }
    return { ...a }
  })
}

export function carryOver(asks: Ask[]): Ask[] {
  return newestEntries(asks.filter(carries), MAX_CARRIED).map(({ a }) => ({ ...a }))
}

/** The same rule again at load: a store written before it may hold anything. */
export function seedCarried(carried: Ask[], opts: { at: number; ids: string[] }): Ask[] {
  return carried
    .filter(carries)
    .flatMap((a, i) => {
      const id = opts.ids[i]
      return id === undefined
        ? []
        : [{ id, text: cleanText(a.text), source: 'carried' as const, state: 'open' as const, claimId: null, at: opts.at }]
    })
}

/** `extra`: further sections (Notes taken, candidates) placed before the closing marker. */
export function printSection(asks: Ask[], ledger: Ledger, extra: readonly string[] = []): string {
  const c = counts(asks)
  const open = c.total - c.done - c.pale
  const live = asks.filter((a) => a.state !== 'dropped')
  const listed = (group: Ask[], tag: string) => {
    const of = (s: Ask['state']) => group.filter((a) => a.state === s)
    return [
      ...of('witnessed').map((a) => `- [x] ${cleanText(a.text)}${tag}`),
      ...of('claimed').map((a) => `- [ ] ${cleanText(a.text)}${tag} (pale: claimed, never witnessed)`),
      ...of('open').map((a) => `- [ ] ${cleanText(a.text)}${tag}`),
    ]
  }
  const items = listed(live.filter(isSessionAsk), '')
  const carriedItems = listed(live.filter((a) => a.source === 'carried'), ' (carried)')
  const builds = live.filter((a) => a.source === 'build').map((a) => `- ${cleanText(a.text)} (build)`)
  // A subagent's report is labelled as one (1.1): the main session has still to read it back.
  const paleClaims = ledger.claims
    .filter((cl) => cl.state === 'pale')
    .map((cl) => `- pale ${cl.agentId === undefined ? 'claim' : 'agent claim'}: ${cleanText(cl.text)}`)
  const lines = [
    '## Witness print',
    '',
    `Asks: ${c.done} of ${c.total} witnessed, ${c.pale} pale, ${open} open.`,
  ]
  if (items.length > 0) lines.push('', ...items)
  if (carriedItems.length > 0) {
    lines.push('', `Carried in from the last watch: ${c.carried} undone, not carried again.`, '', ...carriedItems)
  }
  if (builds.length > 0) {
    lines.push('', `Builds (multi-session; each becomes a to-do at /close): ${builds.length}.`, '', ...builds)
  }
  if (paleClaims.length > 0) lines.push('', ...paleClaims)
  if (extra.length > 0) lines.push('', ...extra.map((l) => l.replace(/\r?\n/g, ' ')))
  lines.push('', PRINT_END)
  return lines.join('\n')
}
