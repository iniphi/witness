// Classify one tool call into the writes it made and the reads it did, so the
// claim ledger (witness.ts) can match a later read to an earlier write.
// Pure: no DOM, no Node, no $; plain strings in, plain data out; never mutates.
//
// Targets are normalised: files lower-case with forward slashes; Notion ids the
// bare 32-hex lower-case id; tables as sql.ts gives them. Inside ONE call, a read
// that comes after a write (a later shell segment, a later SQL statement) marks
// that write selfWitnessed, so the ledger never has to order touches in a call.
//
// An MCP or shell call this file recognises nothing in, and that the harness did
// not judge read-only, is ONE unknown write (`other:<tool>`, `other:shell`).
// Nothing ever witnesses an unknown write: a claim resting on one stays pale.

import type { Classified, Touch } from '../types'
import { maskSql, statements, tablesRead, tablesWritten, writerCalls } from './sql'

export type ToolCall = {
  tool: string
  input: Record<string, unknown>
  resultText: string
  isError: boolean
  /** The harness judged this call read-only: an unrecognised call then wrote nothing. */
  isReadOnly?: boolean
  /** The SELECT-led write functions (config `writerCalls`); absent, the estate's list. */
  writers?: RegExp | null
}

type SelfTouch = Touch & { selfWitnessed: boolean }
export type TouchEvent = { op: 'read'; touch: Touch } | { op: 'write'; touch: Touch; self: boolean }

export const NOTHING: Classified = { writes: [], reads: [] }
export const ALL_FILES = '*'
export const ALL_GIT = 'git:*'
export const ALL_MIGRATIONS = 'migration:*'
export const ALL_TRIGGERS = 'trigger:*'
export const NEW_NOTION = 'notion:new'
export const NEW_TRIGGER = 'trigger:new'
export const OTHER_SHELL = 'other:shell'
const UNKNOWN_NOTION = 'notion:unknown'

// ---------------------------------------------------------------- normalising

export function normPath(raw: string): string {
  const slashed = raw.trim().replace(/["']/g, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  // Git Bash spells C:\x as /c/x; without this a shell read-back never meets a Write's path (S164).
  const noDot = slashed.replace(/^\/([a-z])(?=\/|$)/i, '$1:').replace(/^(\.\/)+/, '')
  const trimmed = noDot.length > 1 ? noDot.replace(/\/+$/, '') : noDot
  return (trimmed || noDot).toLowerCase()
}

const NOTION_ID =
  /(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi

/** Every Notion id in the text (URL, dashed uuid or bare hex), bare lower-case, deduped. */
export function notionIds(text: string): string[] {
  const found = text.match(NOTION_ID) ?? []
  return [...new Set(found.map((m) => m.replace(/-/g, '').toLowerCase()))]
}

export function normNotionId(raw: string): string | null {
  return notionIds(raw)[0] ?? null
}

/** Most targets one report is read for; the rest are ignored. */
export const MAX_NAMED = 12
const URL_RE = /\bhttps?:\/\/\S+/gi
// A path names at least one folder and ends in a file with an extension; a space ends it.
const PATH_RE = /(?:[A-Za-z]:[\\/]|\/)?(?:[\w.@~-]+[\\/])+[\w@~-][\w.@~-]*\.[A-Za-z0-9]{1,8}(?![\w\\/])/g
// A table in the workspace or public schema; a call (`schema.fn(`) is not a table.
const TABLE_RE = /\b(?:workspace|public)\.[a-z_][a-z0-9_]*\b(?!\s*\()/gi

/**
 * The targets a subagent's report names (1.1), read conservatively: file paths with a folder
 * and an extension, `workspace.` or `public.` tables, Notion page ids. A report resting on no
 * write the ledger knows develops only when the main loop reads one of these back.
 */
export function namedTargets(text: string): Touch[] {
  const raw = String(text ?? '')
  const notion = notionIds(raw).map((id): Touch => ({ kind: 'notion', target: id }))
  const prose = raw.replace(URL_RE, ' ')
  const files = (prose.match(PATH_RE) ?? []).map((p): Touch => ({ kind: 'file', target: normPath(p) }))
  const tables = (prose.match(TABLE_RE) ?? []).map((t): Touch => ({ kind: 'sql', target: t.toLowerCase() }))
  return dedupe([...files, ...tables, ...notion]).slice(0, MAX_NAMED)
}

/** True when `path` sits beneath directory `dir` (segment boundary respected). */
export function isUnder(path: string, dir: string): boolean {
  return dir.length > 0 && path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}

/** Does this read witness that write? Same kind and target, or a wider read. Never an `other` write. */
export function covers(read: Touch, write: Touch): boolean {
  if (write.kind === 'other' || read.kind !== write.kind) return false
  if (read.target === write.target) return true
  return WIDER[read.kind](read.target, write.target)
}

const WIDER: Record<Touch['kind'], (r: string, w: string) => boolean> = {
  file: (r, w) => r === ALL_FILES || isUnder(w, r),
  git: (r) => r === ALL_GIT,
  migration: (r) => r === ALL_MIGRATIONS,
  notion: (_, w) => w === NEW_NOTION,
  trigger: (r, w) => r === ALL_TRIGGERS || w === NEW_TRIGGER,
  sql: () => false,
  other: () => false,
}

/** Fold ordered events into a Classified: a read marks every earlier covered write. */
export function fold(events: TouchEvent[]): Classified {
  const writes: SelfTouch[] = []
  const reads: Touch[] = []
  for (const ev of events) {
    if (ev.op === 'write') {
      writes.push({ ...ev.touch, selfWitnessed: ev.self })
      continue
    }
    reads.push(ev.touch)
    writes.forEach((w, i) => {
      if (!w.selfWitnessed && covers(ev.touch, w)) writes[i] = { ...w, selfWitnessed: true }
    })
  }
  return { writes: dedupe(writes), reads: dedupe(reads) }
}

/** One entry per kind+target, in first-seen order, carrying the LAST occurrence's value. */
function dedupe<T extends Touch>(items: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const t of items) byKey.set(`${t.kind}\u0000${t.target}`, t)
  return [...byKey.values()]
}

const read = (touch: Touch): TouchEvent => ({ op: 'read', touch })
const write = (touch: Touch, self = false): TouchEvent => ({ op: 'write', touch, self })
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// ---------------------------------------------------------------- shell

/** Split on unquoted separators; `sep` gives the separator's length at i (0 = none). */
function splitQuoted(text: string, sep: (s: string, i: number) => number): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    const n = quote ? 0 : sep(text, i)
    if (n > 0) {
      out.push(cur)
      cur = ''
      i += n - 1
      continue
    }
    if (quote && c === quote) quote = null
    else if (!quote && (c === '"' || c === "'")) quote = c
    cur += c
  }
  return [...out, cur].map((s) => s.trim()).filter(Boolean)
}

const segmentSep = (s: string, i: number): number =>
  s.startsWith('&&', i) || s.startsWith('||', i) ? 2 : /[;\n|]/.test(s[i] ?? '') ? 1 : 0
const splitSegments = (cmd: string): string[] => splitQuoted(cmd, segmentSep)
const tokenize = (seg: string): string[] => splitQuoted(seg, (s, i) => (/\s/.test(s[i] ?? '') ? 1 : 0))

const unquote = (t: string): string => t.replace(/["']/g, '')
const SINK = /^(&\d|\/dev\/null|\$null|nul)$/i
const REDIRECT = /^(?:\d|&)?>>?(.*)$/

/** Pull `>` / `>>` redirects out of the raw tokens: the words left, and the files written. */
function splitRedirects(raw: string[]): { words: string[]; targets: string[] } {
  const words: string[] = []
  const targets: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const m = REDIRECT.exec(raw[i] ?? '')
    if (!m) {
      words.push(unquote(raw[i] ?? ''))
      continue
    }
    const target = m[1] ? m[1] : raw[++i] ?? ''
    if (target && !SINK.test(unquote(target))) targets.push(unquote(target))
  }
  return { words, targets }
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** One segment's words from its command word on (env assignments, `&`, sudo skipped), and its redirect targets. */
function commandWords(seg: string): { cmd: string[]; targets: string[] } {
  const { words, targets } = splitRedirects(tokenize(seg))
  const start = words.findIndex((w) => !ASSIGNMENT.test(w) && w !== '&' && w !== 'sudo')
  return { cmd: start < 0 ? [] : unwrapCompound(words.slice(start), seg), targets }
}

// Shell words that open or close a compound command. The separators split a loop or an
// `if` into segments; each is classified by the command it wraps (S164: a read-only
// `for ... do grep ...; done` was an unknown write, so its turn's claim stayed pale).
const OPENERS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{'])
const CLOSERS = new Set(['fi', 'done', '}'])

function unwrapCompound(words: string[], seg: string): string[] {
  let i = 0
  // An assignment after an opener (`do n=$((...))`) is skipped as one at the head is (F1, 2026-10-09).
  while (i < words.length && (OPENERS.has(words[i] ?? '') || ASSIGNMENT.test(words[i] ?? ''))) i++
  const rest = words.slice(i)
  const head = rest[0] ?? ''
  if (CLOSERS.has(head)) return []
  // A for header names a list, not a command - unless the list runs one, which stays unknown.
  if (head === 'for' && !/\$\(|`/.test(seg)) return []
  return rest
}

/** A command word as a bare name: no directory, lower-case, no .exe/.cmd/.bat/.ps1. */
const commandName = (word: string): string =>
  word.toLowerCase().replace(/^.*[/\\]/, '').replace(/\.(exe|cmd|bat|ps1)$/, '')

// ---------------------------------------------------------------- test runs

const CD_WORDS = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl'])
const HELP_ARGS = new Set(['--version', '--help', '-h', '-?'])
const BARE_RUNNERS = new Set(['pytest', 'py.test', 'tsc', 'vitest', 'jest'])
const NODE_RUNNERS = new Set(['tsc', 'vitest', 'jest'])
const NPX_VALUE_FLAGS = new Set(['-p', '--package'])
const PYTHON = /^(python[0-9.]*|py)$/
const PY_VALUE_FLAGS = new Set(['-X', '-W'])

/** `python [flags] -m pytest|unittest`: only flags may come before -m (a script would own it). */
function pythonModule(args: string[]): boolean {
  let i = 0
  while (i < args.length && args[i] !== '-m') {
    const a = args[i] ?? ''
    if (!a.startsWith('-')) return false
    i += PY_VALUE_FLAGS.has(a) ? 2 : 1
  }
  const mod = args[i + 1] ?? ''
  return mod === 'pytest' || mod === 'unittest'
}

/** `npx [-y] [-p <pkg>] <runner> ...`: the first word after npx's own flags must be a node runner. */
function npxRunner(args: string[]): boolean {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += NPX_VALUE_FLAGS.has(args[i] ?? '') ? 2 : 1
  const rest = args.slice(i)
  return NODE_RUNNERS.has(commandName(rest[0] ?? '')) && isRunner(rest)
}

/** True when the command word itself is a test or check runner, not asked for its version or help. */
function isRunner(cmd: string[]): boolean {
  const name = commandName(cmd[0] ?? '')
  const args = cmd.slice(1)
  const low = args.map((a) => a.toLowerCase())
  if (low.some((a) => HELP_ARGS.has(a) || (name === 'tsc' && a === '-v'))) return false
  if (BARE_RUNNERS.has(name)) return true
  if (PYTHON.test(name)) return pythonModule(args)
  if (name === 'npm') return low[0] === 'test' || (low[0] === 'run' && low[1] === 'test')
  if (name === 'npx') return npxRunner(args)
  if (name === 'claude') return low[0] === 'plugin' && (low[1] === 'test' || low[1] === 'validate')
  return false
}

/**
 * True when the command's own word is a test or check run (pytest, python -m pytest,
 * npm test, npx vitest|tsc, claude plugin test|validate, tsc) - a mention of one
 * (`pip install pytest`, `grep pytest .`, `tsc --version`) is not. Leading cd segments are skipped.
 */
export function isTestRun(command: string): boolean {
  const cmds = splitSegments(command).map((s) => commandWords(s).cmd)
  const first = cmds.find((c) => !CD_WORDS.has(commandName(c[0] ?? '')))
  return first !== undefined && isRunner(first)
}

// ---------------------------------------------------------------- shell commands

const GIT_WRITES = new Set(['commit', 'push'])
const GIT_READS = new Set(['status', 'log', 'show', 'diff', 'rev-parse'])

function gitEvents(args: string[]): TouchEvent[] {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = (args[i] ?? '').toLowerCase()
  if (GIT_WRITES.has(sub)) return [write({ kind: 'git', target: `git:${sub}` })]
  if (GIT_READS.has(sub)) return [read({ kind: 'git', target: ALL_GIT })]
  return []
}

function segmentEvents(seg: string): TouchEvent[] {
  const { cmd, targets } = commandWords(seg)
  const name = commandName(cmd[0] ?? '')
  const own = name === 'git'
    ? gitEvents(cmd.slice(1))
    : isRunner(cmd)
      ? [read({ kind: 'file', target: ALL_FILES })]
      : fileCommandEvents(name, cmd.slice(1))
  return [...own, ...targets.map((t) => write({ kind: 'file', target: normPath(t) }))]
}

// Flags that take a value, per command (case-sensitive for Unix tools).
const VALUE_FLAGS: Record<string, string[]> = {
  head: ['n', 'c', 'lines', 'bytes'],
  tail: ['n', 'c', 'lines', 'bytes'],
  grep: ['e', 'f', 'm', 'A', 'B', 'C', 'regexp', 'file', 'max-count', 'context', 'after-context', 'before-context'],
  rg: ['e', 'f', 'm', 'A', 'B', 'C', 'g', 't', 'T', 'regexp', 'file', 'glob', 'type', 'type-not', 'max-count'],
  sed: ['e', 'f', 'expression', 'file'],
}
const PATTERN_FLAGS = ['e', 'f', 'regexp', 'file', 'expression']
const PS_SWITCHES = new Set(['force', 'recurse', 'raw', 'nonewline', 'append', 'whatif', 'confirm', 'wait', 'noclobber', 'passthru', 'asbytestream'])

type Parsed = { pos: string[]; flags: Record<string, string | true> }

function parseArgs(args: string[], takesValue: (name: string) => boolean, caseless: boolean): Parsed {
  const pos: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a.length < 2 || !a.startsWith('-') || /^-\d+$/.test(a)) {
      if (!/^-\d+$/.test(a)) pos.push(a)
      continue
    }
    const body = caseless ? a.replace(/^-+/, '').toLowerCase() : a.replace(/^-+/, '')
    const name = body.split(/[=:]/)[0] ?? body
    if (body === name && takesValue(name) && i + 1 < args.length) flags[name] = args[++i] ?? ''
    else flags[name] = true
  }
  return { pos, flags }
}

const pathish = (p: string): boolean => p.length > 0 && p !== '-' && !/^\d+$/.test(p) && !/[*?]/.test(p)
const files = (paths: string[], op: 'read' | 'write'): TouchEvent[] =>
  paths.filter(pathish).map((p) => (op === 'read' ? read : write)({ kind: 'file', target: normPath(p) }))

function unixEvents(name: string, args: string[]): TouchEvent[] {
  const valueFlags = new Set(VALUE_FLAGS[name] ?? [])
  const { pos, flags } = parseArgs(args, (n) => valueFlags.has(n), false)
  const hasPattern = PATTERN_FLAGS.some((f) => f in flags)
  const patternFirst = (name === 'grep' || name === 'rg' || name === 'sed') && !hasPattern
  const paths = patternFirst ? pos.slice(1) : pos
  const inPlace = name === 'sed' && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'))
  return files(paths, inPlace ? 'write' : 'read')
}

function psEvents(name: string, args: string[]): TouchEvent[] {
  const { pos, flags } = parseArgs(args, (n) => !PS_SWITCHES.has(n), true)
  const flag = (k: string): string => (typeof flags[k] === 'string' ? (flags[k] as string) : '')
  const path = flag('path') || flag('literalpath') || flag('filepath') || (pos[0] ?? '')
  if (name === 'get-content' || name === 'gc') return files([path], 'read')
  if (name === 'copy-item' || name === 'cpi') return files([flag('destination') || (pos[1] ?? '')], 'write')
  if (name === 'move-item' || name === 'mi') return files([path, flag('destination') || (pos[1] ?? '')], 'write')
  return files([path], 'write')
}

const UNIX_READERS = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'sed'])
const PS_FILE_CMDS = new Set(['get-content', 'gc', 'set-content', 'add-content', 'out-file', 'remove-item', 'ri', 'copy-item', 'cpi', 'move-item', 'mi'])

function fileCommandEvents(name: string, args: string[]): TouchEvent[] {
  if (UNIX_READERS.has(name)) return unixEvents(name, args)
  if (PS_FILE_CMDS.has(name)) return psEvents(name, args)
  const { pos } = parseArgs(args, () => false, false)
  if (name === 'rm' || name === 'mv' || name === 'tee') return files(pos, 'write')
  if (name === 'cp') return files(pos.slice(-1), 'write')
  return []
}

/**
 * A command's file touches, with relative paths placed by any `cd` earlier in the same
 * command (S164: `cd hooks && grep x sql.ts` read `sql.ts`, which never met the write
 * of `c:/.../hooks/sql.ts`). Only the command's own cd is followed: the call's starting
 * directory is not in its input, so a path with no cd before it stays as written.
 */
export function shellEvents(command: string): TouchEvent[] {
  // A substitution runs first, in a subshell of its own, so it is classified with no cd.
  const { outer, inner } = substitutions(command)
  let dir: string | null = null
  const out: TouchEvent[] = inner.flatMap(shellEvents)
  for (const seg of splitSegments(outer)) {
    const { cmd } = commandWords(seg)
    if (CD_WORDS.has(commandName(cmd[0] ?? ''))) {
      dir = cdInto(dir, cmd.slice(1))
      continue
    }
    out.push(...segmentEvents(seg).map((ev) => placed(ev, dir)))
  }
  return out
}

/** Stands in for a substitution's output: a value, never a path anyone can witness. */
const SUBSTITUTED = '$SUB'

/** The index of the `)` that closes the `(` at `open`, past nested parens and quoted text; -1 if none. */
function closingParen(s: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && quote !== "'") i++
    else if (quote !== null) quote = c === quote ? null : quote
    else if (c === "'" || c === '"') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * Command substitutions pulled out of a command: `$(...)`, backticks, and the process
 * substitutions `<(...)` / `>(...)`. Each is a command of its own (S164: `echo $(rm x)`
 * was classed by `echo` alone, so the write went unseen). `$((...))` is arithmetic and
 * runs nothing of its own, but a substitution inside it runs (`$(( $(rm x) ))`), so its
 * body is read for them; single quotes and a backslash keep `$(` literal. An unclosed one
 * leaves `balanced` false, which the unknown-write rule reads as a command it cannot judge.
 */
export function substitutions(command: string): { outer: string; inner: string[]; balanced: boolean } {
  let outer = ''
  const inner: string[] = []
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? ''
    if (c === '\\' && quote !== "'") {
      outer += command.slice(i, i + 2)
      i++
      continue
    }
    if (quote === "'") {
      if (c === "'") quote = null
      outer += c
      continue
    }
    if (c === '"') quote = quote === '"' ? null : '"'
    else if (c === "'" && quote === null) quote = "'"
    if (c === '"' || c === "'") {
      outer += c
      continue
    }
    const process = quote === null && (c === '<' || c === '>') && command[i + 1] === '('
    if ((c === '$' && command[i + 1] === '(') || process) {
      const end = closingParen(command, i + 1)
      if (end < 0) return { outer: outer + command.slice(i), inner, balanced: false }
      const arithmetic = !process && command[i + 2] === '('
      if (arithmetic) {
        const nested = substitutions(command.slice(i + 3, end - 1))
        if (!nested.balanced) return { outer: outer + command.slice(i), inner, balanced: false }
        inner.push(...nested.inner)
      } else inner.push(command.slice(i + 2, end))
      outer += SUBSTITUTED
      i = end
      continue
    }
    if (c === '`') {
      const end = command.indexOf('`', i + 1)
      if (end < 0) return { outer: outer + command.slice(i), inner, balanced: false }
      inner.push(command.slice(i + 1, end))
      outer += SUBSTITUTED
      i = end
      continue
    }
    outer += c
  }
  return { outer, inner, balanced: true }
}

/** A place a cd went that the classifier cannot know: home, the previous directory, a variable. */
const UNPLACED = '\u0000unplaced'

const isAbsolute = (p: string): boolean => p.startsWith('/') || p.startsWith('~') || /^[a-z]:(\/|$)/.test(p)

const isDrive = (part: string): boolean => /^[a-z]:$/.test(part)

/** Join a normalised path onto a directory, folding `.` and `..`; `..` never climbs above a root. */
function joinPath(dir: string, rel: string): string {
  const rooted = dir.startsWith('/')
  const parts: string[] = []
  for (const part of `${dir}/${rel}`.split('/')) {
    if (part === '' || part === '.') continue
    const last = parts[parts.length - 1]
    if (part !== '..') parts.push(part)
    else if (last !== undefined && last !== '..' && !isDrive(last)) parts.pop()
    else if (!rooted && (last === undefined || last === '..')) parts.push('..')
  }
  const joined = parts.join('/')
  return rooted ? `/${joined}` : joined || '.'
}

function cdInto(dir: string | null, args: string[]): string {
  const where = args.find((a) => !a.startsWith('-')) ?? ''
  if (where === '' || where.includes('$') || where.startsWith('~')) return UNPLACED
  const p = normPath(where)
  if (isAbsolute(p)) return joinPath(p, '.')
  if (dir === UNPLACED) return UNPLACED
  return joinPath(dir ?? '.', p)
}

function placed(ev: TouchEvent, dir: string | null): TouchEvent {
  const t = ev.touch.target
  if (ev.touch.kind !== 'file' || dir === null || dir === UNPLACED) return ev
  if (t === ALL_FILES || t.includes('$') || isAbsolute(t)) return ev
  return { ...ev, touch: { ...ev.touch, target: joinPath(dir, t) } }
}

// ---------------------------------------------------------------- Supabase

/** Rows in an execute_sql result: the length of the JSON array inside the wrapper, or null. */
export function rowCount(text: string): number | null {
  const wrapped = /<untrusted-data-([^>\s]+)>([\s\S]*?)<\/untrusted-data-\1>/.exec(text)
  const body = wrapped ? (wrapped[2] ?? '') : text
  return arrayLength(body) ?? arrayLength(body.replace(/\\"/g, '"').replace(/\\n/g, '\n'))
}

function arrayLength(body: string): number | null {
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const v: unknown = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(v) ? v.length : null
  } catch {
    return null
  }
}

export function isCancelled(text: string): boolean {
  return /\\?"status\\?"\s*:\s*\\?"cancel/i.test(text)
}

function statementEvents(s: string, shows: boolean, cancelled: boolean, writers?: RegExp | null): TouchEvent[] {
  const returning = /\breturning\b/i.test(maskSql(s))
  const reads = cancelled ? [] : tablesRead(s).map((t) => read({ kind: 'sql', target: t }))
  const tables = tablesWritten(s).map((t) => write({ kind: 'sql', target: t }, !cancelled && returning && shows))
  const fns = writerCalls(s, writers).map((f) => write({ kind: 'sql', target: `fn:${f}` }, !cancelled && shows))
  return [...reads, ...tables, ...fns]
}

export function classifySql(query: string, resultText: string, writers?: RegExp | null): Classified {
  const cancelled = isCancelled(resultText)
  const shows = (rowCount(resultText) ?? 0) > 0
  const folded = fold(statements(query).flatMap((s) => statementEvents(s, shows, cancelled, writers)))
  const readsAny = !cancelled && (folded.reads.length > 0 || folded.writes.length === 0)
  if (!readsAny) return folded
  return { ...folded, reads: [...folded.reads, { kind: 'migration', target: ALL_MIGRATIONS }] }
}

// ---------------------------------------------------------------- Notion

const NOTION_CREATES = new Set(['notion-create-pages', 'notion-create-database', 'notion-create-view', 'notion-duplicate-page'])
const NOTION_UPDATES = new Set(['notion-update-page', 'notion-update-data-source', 'notion-update-view', 'notion-move-pages'])
const ID_KEYS = ['page_id', 'data_source_id', 'database_id', 'view_id', 'id', 'page_or_database_ids', 'parent', 'new_parent']

function stringsIn(v: unknown, depth = 0): string[] {
  if (typeof v === 'string') return [v]
  if (depth > 4 || v === null || typeof v !== 'object') return []
  const values = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)
  return values.flatMap((x) => stringsIn(x, depth + 1))
}

const notionTouches = (ids: string[], fallback: string): Touch[] =>
  (ids.length > 0 ? ids : [fallback]).map((target) => ({ kind: 'notion' as const, target }))

export function classifyNotion(name: string, input: Record<string, unknown>, resultText: string): Classified {
  const allInput = notionIds(stringsIn(input).join(' '))
  if (NOTION_CREATES.has(name)) {
    const created = notionIds(resultText).filter((id) => !allInput.includes(id))
    return { writes: notionTouches(created, NEW_NOTION).map((t) => ({ ...t, selfWitnessed: false })), reads: [] }
  }
  if (NOTION_UPDATES.has(name)) {
    const keyed = notionIds(ID_KEYS.flatMap((k) => stringsIn(input[k])).join(' '))
    return { writes: notionTouches(keyed, NEW_NOTION).map((t) => ({ ...t, selfWitnessed: false })), reads: [] }
  }
  if (name === 'notion-fetch') return { writes: [], reads: notionTouches(allInput, UNKNOWN_NOTION) }
  if (name === 'notion-query-data-sources') {
    const ids = [...new Set([...allInput, ...notionIds(resultText)])]
    return { writes: [], reads: notionTouches(ids, UNKNOWN_NOTION) }
  }
  return NOTHING
}

// ---------------------------------------------------------------- RemoteTrigger

const TRIGGER_WRITES = new Set(['create', 'update', 'run', 'create_webhook_trigger'])
const TRIGGER_READS = new Set(['get', 'list', 'list_runs', 'get_run_log'])

export function classifyTrigger(input: Record<string, unknown>, resultText: string): Classified {
  const action = str(input.action)
  const id = str(input.trigger_id)
  if (TRIGGER_WRITES.has(action)) {
    const found = id || (/\btrig_[A-Za-z0-9]+/.exec(resultText)?.[0] ?? '')
    const target = found ? `trigger:${found}` : NEW_TRIGGER
    return { writes: [{ kind: 'trigger', target, selfWitnessed: false }], reads: [] }
  }
  if (TRIGGER_READS.has(action)) return { writes: [], reads: [{ kind: 'trigger', target: id ? `trigger:${id}` : ALL_TRIGGERS }] }
  return NOTHING
}

// ---------------------------------------------------------------- dispatch

function fileTouch(op: 'read' | 'write', path: unknown): Classified {
  const p = str(path)
  if (!p.trim()) return NOTHING
  const touch: Touch = { kind: 'file', target: normPath(p) }
  return op === 'read' ? { writes: [], reads: [touch] } : { writes: [{ ...touch, selfWitnessed: false }], reads: [] }
}

const SUPABASE = /^mcp__.*supabase.*__([a-z_]+)$/i
const NOTION = /^mcp__.*notion.*__(notion-[a-z-]+)$/i

function classifyMcp(tool: string, input: Record<string, unknown>, resultText: string, writers?: RegExp | null): Classified {
  const supa = SUPABASE.exec(tool)?.[1]
  if (supa === 'execute_sql') return classifySql(str(input.query), resultText, writers)
  if (supa === 'apply_migration') {
    const name = str(input.name).trim().toLowerCase() || 'unnamed'
    return { writes: [{ kind: 'migration', target: `migration:${name}`, selfWitnessed: false }], reads: [] }
  }
  if (supa === 'list_tables' || supa === 'list_migrations') {
    return { writes: [], reads: [{ kind: 'migration', target: ALL_MIGRATIONS }] }
  }
  const notion = NOTION.exec(tool)?.[1]
  return notion ? classifyNotion(notion.toLowerCase(), input, resultText) : NOTHING
}

const isShell = (tool: string): boolean => tool === 'Bash' || tool === 'PowerShell'

/** What a recognised tool call wrote and read (no unknown-write rule applied). */
function known(call: ToolCall, input: Record<string, unknown>, resultText: string): Classified {
  switch (call.tool) {
    case 'Edit': case 'Write': return fileTouch('write', input.file_path)
    case 'NotebookEdit': return fileTouch('write', input.notebook_path ?? input.file_path)
    case 'Read': return fileTouch('read', input.file_path)
    case 'Grep': return fileTouch('read', input.path)
    case 'Bash': case 'PowerShell': return fold(shellEvents(str(input.command)))
    case 'RemoteTrigger': return classifyTrigger(input, resultText)
    default: return classifyMcp(call.tool, input, resultText, call.writers)
  }
}

// ---------------------------------------------------------------- recognised shell words

const READONLY_WORDS = new Set([
  'diff', 'ls', 'dir', 'wc', 'stat', 'echo', 'printf', 'pwd', 'which', 'where', 'type', 'test', '[',
  'true', 'false', ':', 'continue', 'break', 'date', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'cd',
  'get-childitem', 'get-location', 'test-path', 'select-string',
])
const KNOWN_WRITE_WORDS = new Set(['rm', 'mv', 'cp', 'tee'])
const GIT_READONLY_SUBS = new Set(['fetch', 'ls-tree', 'ls-files', 'log', 'show', 'diff', 'status', 'rev-parse'])

/** The git subcommand and the words after it, past git's own leading flags. */
function gitSub(args: string[]): { sub: string; rest: string[] } {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  return { sub: (args[i] ?? '').toLowerCase(), rest: args.slice(i + 1) }
}

function gitRecognised(args: string[]): boolean {
  const { sub, rest } = gitSub(args)
  if (GIT_WRITES.has(sub) || GIT_READONLY_SUBS.has(sub)) return true
  if (sub === 'branch') return rest.every((a) => a.startsWith('-'))
  return sub === 'remote' && rest.length === 1 && rest[0] === '-v'
}

const findIsReadOnly = (args: string[]): boolean => !args.some((a) => a === '-delete' || a === '-exec' || a === '-execdir')

/** True when the segment's command word is a known read, a known write, or a read-only command. */
function segmentRecognised(seg: string): boolean {
  const { cmd } = commandWords(seg)
  if (cmd.length === 0) return true
  const name = commandName(cmd[0] ?? '')
  const args = cmd.slice(1)
  if (name === 'git') return gitRecognised(args)
  if (name === 'find') return findIsReadOnly(args)
  if (isRunner(cmd)) return true
  return (
    READONLY_WORDS.has(name) || CD_WORDS.has(name) || KNOWN_WRITE_WORDS.has(name) || UNIX_READERS.has(name) || PS_FILE_CMDS.has(name)
  )
}

function allShellRecognised(command: string): boolean {
  const { outer, inner, balanced } = substitutions(command)
  return balanced && splitSegments(outer).every(segmentRecognised) && inner.every(allShellRecognised)
}

/**
 * The companion's own tools (`mcp__witness__confirm` and any later one). They write
 * nothing in the estate, only the mod's own ledgers, so they are never an unknown write:
 * counted as one, the confirm call paled the very turn that confirmed (to-do 3f23...4028).
 * Exact server segment only, so a lookalike server name stays an unknown write.
 */
const OWN_TOOL = /^mcp__witness__/

/** An MCP or shell call that touched nothing known, not judged read-only: one unknown write. */
function unknownWrite(call: ToolCall, c: Classified): Classified {
  if (isShell(call.tool)) return unknownShellWrite(call, c)
  const open = call.tool.startsWith('mcp__') && !OWN_TOOL.test(call.tool)
  if (!open || call.isReadOnly === true || c.writes.length > 0 || c.reads.length > 0) return c
  return { writes: [{ kind: 'other', target: `other:${call.tool}`, selfWitnessed: false }], reads: [] }
}

/** A shell call with at least one unrecognised command word adds one unknown write. */
function unknownShellWrite(call: ToolCall, c: Classified): Classified {
  if (call.isReadOnly === true || allShellRecognised(str(call.input?.command))) return c
  const unknown = { kind: 'other' as const, target: OTHER_SHELL, selfWitnessed: false }
  return { writes: [...c.writes, unknown], reads: c.reads }
}

/**
 * What one tool call wrote and read. An errored call classifies as nothing. Glob
 * lists names and reads no content, so it reads nothing.
 */
export function classify(call: ToolCall): Classified {
  if (call.isError) return NOTHING
  return unknownWrite(call, known(call, call.input ?? {}, call.resultText ?? ''))
}
