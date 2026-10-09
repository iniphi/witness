// Repair pairs (1.2, Bradley 2026-10-09): a failed call, the next successful call on the same
// target, the diff between them, and the tokens every attempt before the cure cost. SQLSTATE is a
// free taxonomy; a failure's epitope is `code|target`. The diff sorts the cure: a changed CALL is
// a hook candidate, a changed ROUTE (another tool reaching the target) a skill line, no change at
// all is weather, logged and left alone. An epitope that recurs is immune memory. Pure: no $,
// no clock (time is the argument `at`), no argument is mutated.

import type { Antigen, OpenFailure, RepairDiff, RepairPair } from '../types'
import { cleanText } from './asks'
import { classify, normPath, notionIds } from './classify'
import { inputText } from './evidence'
import { tablesRead, tablesWritten } from './sql'

/** Main-session calls an open failure waits for its cure. */
export const REPAIR_WINDOW_CALLS = 40
/** Milliseconds an open failure waits for its cure after its last attempt. */
export const REPAIR_WINDOW_MS = 30 * 60_000
export const REPAIRS_KEPT = 100
export const PAIR_TEXT_MAX = 300
export const MAX_DIFF_TOKENS = 6
const TOKEN_MAX = 40
const FRAGMENT_MAX = 120
const REASON_MAX = 160

/** SQLSTATE read as a disease. */
export const KIND_BY_CODE: Readonly<Record<string, string>> = {
  '42703': 'undefined-column', '42P01': 'undefined-table',
  '42601': 'syntax', '23505': 'unique-violation',
  '42883': 'undefined-function', '23502': 'not-null-violation',
  '23503': 'foreign-key-violation', '23514': 'check-violation',
  '22P02': 'invalid-text', '42804': 'datatype-mismatch',
  '42501': 'insufficient-privilege', '42P07': 'duplicate-table',
  '42701': 'duplicate-column', '25P02': 'aborted-transaction',
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)]
const cut = (text: string, max: number): string => {
  const t = cleanText(text)
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`
}
const kindOf = (code: string): string => (Object.prototype.hasOwnProperty.call(KIND_BY_CODE, code) ? (KIND_BY_CODE[code] as string) : code)

/** `mcp__claude_ai_Supabase__execute_sql` -> `execute_sql`; a plain tool name stays. */
export function shortTool(tool: string): string {
  const short = tool.slice(tool.lastIndexOf('__') + 2)
  return tool.includes('__') && short !== '' ? short : tool
}

// A SQLSTATE is five characters of [0-9A-Z] with a digit in them, behind one of the spellings
// an error comes in: `SQLSTATE 42703`, `(SQLSTATE 42703)`, `ERROR:  42703:`, `"code":"42703"`.
const STATE_RE = /(?:SQLSTATE|SQLState|sqlstate)\b[:=\s]*\(?\s*([0-9A-Z]{5})(?![0-9A-Za-z])|\bERROR:\s+([0-9A-Z]{5})(?![0-9A-Za-z])|\\?"code\\?"\s*:\s*\\?"([0-9A-Z]{5})(?![0-9A-Za-z])/g

/** The first SQLSTATE in an error text, or null. */
export function sqlState(text: string): string | null {
  for (const m of String(text ?? '').matchAll(STATE_RE)) {
    const code = m[1] ?? m[2] ?? m[3] ?? ''
    if (/\d/.test(code)) return code
  }
  return null
}

const CLASSES: ReadonlyArray<readonly [string, RegExp]> = [
  ['refused', /\b(?:denied|refused|refusing|refusal)\b|blocked by|not permitted|hook error|permission to use/i],
  ['string-not-found', /string to replace not found|old_string[\s\S]*?not found|not unique in the file/i],
  ['timeout', /timed out|timeout|ETIMEDOUT/i],
  ['not-found', /not found|ENOENT|no such file|does not exist|object_not_found/i],
  ['validation', /validation_error|InputValidationError|invalid input|could not be parsed|invalid_request/i],
]
const HTTP_RE = /(?:\bstatus["']?\s*:?\s*|\bHTTP(?:\/\d(?:\.\d)?)?\s*:?\s+)([45]\d{2})\b/i

/** A non-SQL failure's class, checked in order: the first that fits wins. */
export function errorClass(text: string): string {
  const t = String(text ?? '')
  const hit = CLASSES.find(([, re]) => re.test(t))
  if (hit !== undefined) return hit[0]
  const status = HTTP_RE.exec(t)?.[1]
  return status === undefined ? 'other' : `http-${status}`
}

/** The whole input as one cleaned line (inputText's pick, up to its own cap). */
function fullLine(input: unknown): string {
  if (typeof input === 'string') return cleanText(input)
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object') return cleanText(String(input))
  try {
    // An Edit is told apart by what it replaced: without old_string a corrected Edit of the
    // same file would read as the same call (weather) when its content changed.
    const old = (input as Obj).old_string
    return cleanText(typeof old === 'string' ? `${inputText(input as Obj)} ${old}` : inputText(input as Obj))
  } catch {
    // An input JSON cannot serialise (a cycle, a BigInt) has no line; the call is still kept.
    return ''
  }
}

/** A call's input as one line of at most PAIR_TEXT_MAX characters. */
export const inputLine = (input: unknown): string => fullLine(input).slice(0, PAIR_TEXT_MAX)

/** Tokens a call and its result cost, estimated at four characters each. */
export const estTokens = (input: string, result: string): number => Math.ceil((input.length + result.length) / 4)

type TargetCall = { tool: string; input: unknown; writers?: RegExp | null }

const SENTINELS: ReadonlySet<string> = new Set(['*', 'git:*', 'migration:*', 'trigger:*', 'notion:new', 'trigger:new', 'notion:unknown'])
const KIND_PREFIX = /^(?:fn|git|migration|trigger|notion):/

/** A classified target without its kind prefix; null for a sentinel that names nothing. */
function bare(target: string): string | null {
  if (SENTINELS.has(target) || target.startsWith('other:')) return null
  const t = target.replace(KIND_PREFIX, '').toLowerCase()
  return t === '' ? null : t
}

/** The tables the call's `query` names, written and read, first-seen order. */
function queryTables(input: unknown): string[] {
  const q = isObj(input) ? input.query : undefined
  return typeof q === 'string' && q !== '' ? unique([...tablesWritten(q), ...tablesRead(q)]) : []
}

function classified(c: TargetCall): string[] {
  if (!isObj(c.input)) return []
  const { writes, reads } = classify({ tool: c.tool, input: c.input, resultText: '', isError: false, isReadOnly: false, writers: c.writers })
  return [...writes, ...reads].map((t) => t.target)
}

/** Whether the call sets out to write anything: a failed write is cured only by a write. */
export function writes(c: TargetCall): boolean {
  if (!isObj(c.input)) return false
  return classify({ tool: c.tool, input: c.input, resultText: '', isError: false, isReadOnly: false, writers: c.writers }).writes.length > 0
}

/** The normalised targets a call names, lower-case and deduped: files, tables, Notion ids. */
export function targetsOf(c: TargetCall): string[] {
  const tables = c.tool.includes('execute_sql') || c.tool.includes('apply_migration') ? queryTables(c.input) : []
  const all = [...classified(c), ...notionIds(fullLine(c.input)), ...tables]
  return unique(all.map(bare).filter((t): t is string => t !== null))
}

type CallText = TargetCall & { resultText: string }
type Where = { target: string; fragment: string }

const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit'])
const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Monitor'])
const COLUMN_RE = /\bcolumn\s+((?:"[^"]*"|[\w$]+)(?:\.(?:"[^"]*"|[\w$]+))*)\s+(?:of relation\s+\S+\s+)?does not exist/i
const RELATION_RE = /\brelation\s+"?([\w$.]+)"?\s+does not exist/i

function columnOf(text: string): string | null {
  const col = COLUMN_RE.exec(text)?.[1]?.split('.').pop()?.replace(/"/g, '')
  return col === undefined || col === '' ? null : col
}

const named = (target: string): Where | null => (target === '' ? null : { target, fragment: target })

/** A SQL failure's target: table.column for an undefined column, the relation for an undefined table, else the first table. */
function sqlWhere(c: CallText, code: string): Where | null {
  const table = queryTables(c.input)[0] ?? ''
  const column = code === '42703' ? columnOf(c.resultText) : null
  if (column !== null) return { target: table === '' ? column : `${table}.${column}`, fragment: column }
  const relation = code === '42P01' ? RELATION_RE.exec(c.resultText)?.[1]?.toLowerCase() : undefined
  if (relation !== undefined) return named(relation)
  return table === '' ? null : { target: table, fragment: '' }
}

function fileWhere(input: unknown): Where | null {
  const o = isObj(input) ? input : {}
  const raw = [o.file_path, o.notebook_path].find((p): p is string => typeof p === 'string' && p.trim() !== '')
  return raw === undefined ? null : named(normPath(raw))
}

/** The target and fragment of a failing call: a file, a table and column, a Notion id, else its first target or its tool. */
function whereOf(c: CallText, state: string | null): Where {
  const none: Where = { target: c.tool, fragment: '' }
  if (FILE_TOOLS.has(c.tool)) return fileWhere(c.input) ?? none
  const sql = state === null ? null : sqlWhere(c, state)
  if (sql !== null) return sql
  if (c.tool.toLowerCase().includes('notion')) return named(notionIds(fullLine(c.input))[0] ?? '') ?? none
  return named(targetsOf(c)[0] ?? '') ?? none
}

const firstLine = (text: string): string => text.split(/\r?\n/).map(cleanText).find((l) => l !== '') ?? ''

/** What failed and on what: the antigen of one failing call. */
export function antigenOf(c: CallText): Antigen {
  // An MCP error arrives JSON-escaped, `column \"ask\" does not exist`: any run of backslashes before
  // a quote is undone first, or the column is never read (seen live, S170: the target fell back to
  // the table alone).
  const text = String(c.resultText ?? '').replace(/\\+"/g, '"')
  const state = sqlState(text)
  const code = state ?? errorClass(text)
  const where = whereOf({ ...c, resultText: text }, state)
  return {
    tool: c.tool,
    code,
    kind: kindOf(code),
    target: where.target,
    fragment: cut(where.fragment, FRAGMENT_MAX),
    reason: cut(firstLine(text), REASON_MAX),
  }
}

export const epitope = (a: Antigen): string => `${a.code}|${a.target}`

const clone = (o: OpenFailure): OpenFailure => ({ ...o, antigen: { ...o.antigen }, targets: [...o.targets] })

/** A measured context size, or undefined: a negative, non-finite or absent figure is no measurement. */
export const measured = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined)

/** Two optional sums: absent only while neither side was measured. */
const addOpt = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)

/**
 * A failing main-session call: opens a failure on its epitope, or adds an attempt to the one open.
 * `context` is the input the model was answered over to make this attempt (`$.session.usage()`):
 * every retry re-reads it, which the character estimate of `cost` leaves out (a side agent's note, S170).
 */
export function noteFailure(opens: readonly OpenFailure[], c: CallText & { at: number; context?: number }): OpenFailure[] {
  const antigen = antigenOf(c)
  // A shell command that failed with no known error on nothing it names is exploration (a grep
  // that found nothing), not an antigen: as a pair it would be cured by the next `ls` (the blind
  // verifier, S170). Bradley 2026-10-09: "a shell command that fails once is often exploration".
  if (SHELLS.has(c.tool) && antigen.code === 'other' && antigen.target === c.tool) return opens.map(clone)
  const key = epitope(antigen)
  const line = inputLine(c.input)
  const cost = estTokens(line, String(c.resultText ?? ''))
  const reread = measured(c.context)
  const touched = unique([...targetsOf(c), antigen.target])
  const last = { lastTool: c.tool, lastInput: line, lastFull: fullLine(c.input), lastAt: c.at, since: 0 }
  const kept = opens.map(clone)
  if (!kept.some((o) => o.key === key)) {
    const fresh: OpenFailure = { key, antigen, targets: touched, attempts: 1, cost, firstAt: c.at, write: writes(c), ...last }
    return [...kept, reread === undefined ? fresh : { ...fresh, reread }]
  }
  return kept.map((o) => {
    if (o.key !== key) return o
    const next: OpenFailure = { ...o, ...last, attempts: o.attempts + 1, cost: o.cost + cost, targets: unique([...o.targets, ...touched]) }
    const sum = addOpt(o.reread, reread)
    return sum === undefined ? next : { ...next, reread: sum }
  })
}

/** One more main-session call has passed: open failures past the window of calls or of time are dropped. */
export function age(opens: readonly OpenFailure[], at: number): OpenFailure[] {
  return opens
    .map((o) => ({ ...clone(o), since: o.since + 1 }))
    .filter((o) => o.since <= REPAIR_WINDOW_CALLS && at - o.lastAt <= REPAIR_WINDOW_MS)
}

const HEX32 = /^[0-9a-f]{32}$/

/**
 * Whether the call names the target. A Notion id or a path may sit anywhere in its input (a REST
 * call by shell on the page an MCP call failed on); a bare table name only through the call's own
 * parsed targets, so a diagnostic query that merely mentions the table cures nothing.
 */
function names(target: string, c: { targets: readonly string[] }, low: string, dashless: string): boolean {
  const t = target.toLowerCase()
  if (c.targets.includes(t)) return true
  if (t.length < 6) return false
  if (HEX32.test(t)) return whole(dashless, t)
  return t.includes('/') && whole(low, t)
}

/** A path or id character: a match running into one is part of a longer name. */
const NAME_CHAR = /[\w.$-]/

/** `needle` in `hay` standing whole: `src/a.ts` is not found in `src/a.tsx` (the verifier, S170). */
function whole(hay: string, needle: string): boolean {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = i === 0 ? '' : hay.charAt(i - 1)
    const after = hay.charAt(i + needle.length)
    if (!NAME_CHAR.test(before) && !NAME_CHAR.test(after)) return true
  }
  return false
}

/**
 * Does a successful call land on this open failure's target? A failed write is cured only by a
 * call that writes (`writes` false refuses it): reading the file or the table is the
 * investigation, not the cure. Absent, the call is not judged on it.
 */
export function hits(open: OpenFailure, c: { tool: string; line: string; targets: readonly string[]; writes?: boolean }): boolean {
  if (open.write === true && c.writes === false) return false
  if (open.targets.every((t) => t === open.antigen.tool)) return c.tool === open.lastTool
  const low = c.line.toLowerCase().replace(/\\/g, '/')
  const dashless = low.replace(/-/g, '')
  return open.targets.some((t) => names(t, c, low, dashless))
}

// Identifier-like words, and quoted strings whole (what is inside them is not read again).
const TOKEN_RE = /'[^']*'|"[^"]*"|(?<![\w$])[A-Za-z_][\w.$-]*/g
const flat = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

function onlyIn(from: readonly string[], other: readonly string[]): string[] {
  const seen = new Set(other)
  return unique(from.filter((t) => !seen.has(t)))
    .slice(0, MAX_DIFF_TOKENS)
    .map((t) => t.slice(0, TOKEN_MAX))
}

/**
 * Where a cure differs from its failure. The tokens that went and came are read for a route
 * and a content diff alike; a `none` diff (the same call up to case and spacing) carries none.
 */
export function diffOf(failedTool: string, failed: string, cureTool: string, cured: string): RepairDiff {
  const where = failedTool !== cureTool ? 'route' : flat(failed) === flat(cured) ? 'none' : 'content'
  if (where === 'none') return { where, removed: [], added: [] }
  const before = failed.match(TOKEN_RE) ?? []
  const after = cured.match(TOKEN_RE) ?? []
  return { where, removed: onlyIn(before, after), added: onlyIn(after, before) }
}

function pairOf(o: OpenFailure, cureTool: string, cured: string, at: number, curedFull: string): RepairPair {
  // Compared whole: a fix past the 300 characters kept for display is still a diff (the verifier, S170).
  const diff = diffOf(o.lastTool, o.lastFull ?? o.lastInput, cureTool, curedFull)
  const reread = o.reread === undefined ? {} : { reread: o.reread }
  return {
    ...reread,
    key: o.key,
    antigen: { ...o.antigen },
    failures: o.attempts,
    failedTool: o.lastTool,
    failed: o.lastInput,
    cureTool,
    cured,
    diff,
    cost: o.cost,
    firstAt: o.firstAt,
    at,
    autoimmune: o.antigen.code === 'refused' && diff.where === 'none',
  }
}

/** A successful main-session call: every open failure it lands on becomes a repair pair. */
export function cure(
  opens: readonly OpenFailure[],
  c: { tool: string; input: unknown; at: number; writers?: RegExp | null },
): { opens: OpenFailure[]; pairs: RepairPair[] } {
  const full = fullLine(c.input)
  const line = full.slice(0, PAIR_TEXT_MAX)
  const probe = { tool: c.tool, line: full, targets: targetsOf(c), writes: writes(c) }
  const landed = opens.map((o) => hits(o, probe))
  return {
    opens: opens.filter((_, i) => !landed[i]).map(clone),
    pairs: opens.filter((_, i) => landed[i]).map((o) => pairOf(o, c.tool, line, c.at, full)),
  }
}
