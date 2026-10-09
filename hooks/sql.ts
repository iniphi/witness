// SQL as text for witness: pure string work, no DOM, no Node, no imports.
// Aware of single-quoted strings, double-quoted identifiers, dollar-quoted bodies
// and comments. Analysis runs on a same-length "masked" copy of the SQL in which
// comments, string contents and dollar bodies are blank and quoted identifiers
// are lower-cased with their quotes blanked.

export interface BareWrite {
  readonly verb: 'UPDATE' | 'DELETE'
  readonly table: string
  readonly statement: string
}

interface Stmt {
  readonly original: string
  readonly masked: string
}

interface Found {
  readonly verb: 'UPDATE' | 'DELETE'
  readonly table: string
  readonly from: number
  readonly to: number
  readonly top: boolean
  readonly atStart: boolean
}

const NAME = '[\\w$]+(?:\\s*\\.\\s*[\\w$]+)*'
const UPDATE_RE = new RegExp(`\\bupdate\\s+(?:only\\s+)?(${NAME})(?:\\s+(?:as\\s+)?[\\w$]+)?\\s+set\\b`, 'gi')
const DELETE_RE = new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?(${NAME})`, 'gi')
const INSERT_RE = new RegExp(`\\binsert\\s+into\\s+(${NAME})`, 'gi')
const MERGE_RE = new RegExp(`\\bmerge\\s+into\\s+(?:only\\s+)?(${NAME})`, 'gi')
const TRUNCATE_RE = /\btruncate\s+(?:table\s+)?(?:only\s+)?/gi
// The estate's list, as config.ts DEFAULT_WRITERS builds it; the default when none is passed.
const WRITER_RE =
  /\b(workspace\s*\.\s*(?:close_todo|set_todo_status|pause_todo|crosstalk_[a-z_]+|record_board_attention|claim_item|release_claim))\s*\(/gi
const FUNCTION_FORMS = new Set(['extract', 'substring', 'trim', 'overlay', 'position'])
const KEYWORDS = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'on', 'using',
  'group', 'order', 'limit', 'union', 'returning', 'set', 'having', 'window', 'for', 'offset',
  'fetch', 'except', 'intersect', 'lateral', 'tablesample', 'with', 'restart', 'cascade',
  'restrict', 'continue', 'when', 'values', 'select',
])

function skipLine(sql: string, i: number): number {
  let j = i
  while (j < sql.length && sql[j] !== '\n') j++
  return j
}

function blank(len: number): string {
  return ' '.repeat(len)
}

/** An E'...' string: a backslash escapes the next character, `\'` included. */
function isEscapeString(sql: string, i: number): boolean {
  const prev = sql[i - 1] ?? ''
  const before = sql[i - 2] ?? ' '
  return (prev === 'E' || prev === 'e') && !/[A-Za-z0-9_$]/.test(before)
}

function maskQuoted(sql: string, i: number, q: string): { out: string; end: number } {
  const escapes = q === "'" && isEscapeString(sql, i)
  let j = i + 1
  while (j < sql.length) {
    if (escapes && sql[j] === '\\') {
      j += 2
      continue
    }
    if (sql[j] === q) {
      if (sql[j + 1] === q) {
        j += 2
        continue
      }
      break
    }
    j++
  }
  const end = Math.min(j + 1, sql.length)
  const inner = sql.slice(i + 1, Math.min(j, sql.length))
  if (q === "'") return { out: `'${blank(inner.length)}${j < sql.length ? "'" : ''}`, end }
  const ident = inner.toLowerCase().replace(/[\s"]/g, '_')
  return { out: ` ${ident}${j < sql.length ? ' ' : ''}`, end }
}

export function maskSql(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i] ?? ''
    const nx = sql[i + 1]
    if (c === '-' && nx === '-') {
      const e = skipLine(sql, i)
      out += blank(e - i)
      i = e
    } else if (c === '/' && nx === '*') {
      const k = sql.indexOf('*/', i + 2)
      const e = k === -1 ? sql.length : k + 2
      out += sql.slice(i, e).replace(/[^\n]/g, ' ')
      i = e
    } else if (c === "'" || c === '"') {
      const r = maskQuoted(sql, i, c)
      out += r.out
      i = r.end
    } else if (c === '$' && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
      const tag = (/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)) as RegExpExecArray)[0]
      const k = sql.indexOf(tag, i + tag.length)
      const e = k === -1 ? sql.length : k + tag.length
      out += sql.slice(i, e).replace(/[^\n]/g, ' ')
      i = e
    } else {
      out += c
      i++
    }
  }
  return out
}

function splitStmts(sql: string): Stmt[] {
  const masked = maskSql(sql)
  const result: Stmt[] = []
  let start = 0
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const m = masked.slice(start, i)
      if (m.trim() !== '') result.push({ original: sql.slice(start, i), masked: m })
      start = i + 1
    }
  }
  return result
}

export function statements(sql: string): string[] {
  return splitStmts(sql).map((s) => s.original.trim())
}

function normName(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase()
}

function depthsOf(masked: string): number[] {
  const d: number[] = []
  let cur = 0
  for (const c of masked) {
    d.push(cur)
    if (c === '(') cur++
    else if (c === ')') cur--
  }
  d.push(cur)
  return d
}

function prevContentChar(masked: string, at: number): string {
  for (let i = at - 1; i >= 0; i--) {
    const c = masked[i] ?? ''
    if (!/\s/.test(c)) return c
  }
  return ''
}

function bodyEnd(masked: string, depths: readonly number[], from: number): number {
  for (let i = from; i < masked.length; i++) {
    if (masked[i] === ')' && depths[i] === depths[from]) return i
  }
  return masked.length
}

function findWrites(stmt: Stmt): Found[] {
  const { masked } = stmt
  const depths = depthsOf(masked)
  const first = masked.search(/\S/)
  const found: Found[] = []
  const scan = (re: RegExp, verb: 'UPDATE' | 'DELETE') => {
    for (const m of masked.matchAll(re)) {
      const from = m.index ?? 0
      const prev = prevContentChar(masked, from)
      const top = prev === '' || (prev === ')' && depths[from] === 0)
      if (!(top || prev === '(')) continue
      if (verb === 'UPDATE' && normName(m[1] ?? '') === 'set') continue
      const to = top ? masked.length : bodyEnd(masked, depths, from)
      found.push({ verb, table: normName(m[1] ?? ''), from, to, top, atStart: from === first })
    }
  }
  scan(UPDATE_RE, 'UPDATE')
  scan(DELETE_RE, 'DELETE')
  return found.sort((a, b) => a.from - b.from)
}

function hasReturning(masked: string, f: Found): boolean {
  return /\breturning\b/i.test(masked.slice(f.from, f.to))
}

function bareIn(stmt: Stmt): BareWrite[] {
  return findWrites(stmt)
    .filter((f) => !hasReturning(stmt.masked, f))
    .map((f) => ({
      verb: f.verb,
      table: f.table,
      statement: stmt.original.slice(f.from, f.to).trim(),
    }))
}

export function bareWrites(sql: string): BareWrite[] {
  return splitStmts(sql).flatMap(bareIn)
}

export function needsHold(sql: string): boolean {
  return bareWrites(sql).length > 0
}

/**
 * The CTE form of a single bare top-level UPDATE or DELETE, or null whenever the
 * rewrite cannot be proved to carry the whole statement: an unclosed string,
 * identifier, comment or dollar body (the mask then no longer lines up with the
 * text), or a body that is not the statement minus trailing blanks. A null offers
 * only "let through" and "cancel": never guess at a cut that could drop a WHERE.
 */
export function withReturning(sql: string): string | null {
  if (maskSql(sql).length !== sql.length) return null
  const stmts = splitStmts(sql)
  if (stmts.length !== 1) return null
  const stmt = stmts[0] as Stmt
  if (stmt.masked.length !== stmt.original.length) return null
  const writes = findWrites(stmt)
  const w = writes[0]
  if (writes.length !== 1 || !w || !w.atStart || !w.top || hasReturning(stmt.masked, w)) return null
  const end = stmt.masked.trimEnd().length
  const body = stmt.original.slice(w.from, end)
  const whole = stmt.original.slice(0, end).trim()
  if (body.trim() !== whole || !/\bwhere\b/i.test(stmt.masked)) return null
  return `WITH w AS (${body} RETURNING *) SELECT * FROM w`
}

function ctesIn(masked: string): Set<string> {
  const names = new Set<string>()
  for (const m of masked.matchAll(/([\w$]+)\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/gi)) {
    names.add((m[1] ?? '').toLowerCase())
  }
  return names
}

function parseList(masked: string, start: number, commas: boolean): string[] {
  const names: string[] = []
  let pos = start
  const nameRe = new RegExp(`(?:only\\s+)?(?:lateral\\s+)?(${NAME})`, 'iy')
  const aliasRe = /\s*(?:as\s+)?([\w$]+)/iy
  for (;;) {
    nameRe.lastIndex = pos
    const m = nameRe.exec(masked)
    if (!m) break
    pos = nameRe.lastIndex
    if (/^\s*\(/.test(masked.slice(pos))) break
    names.push(normName(m[1] ?? ''))
    aliasRe.lastIndex = pos
    const a = aliasRe.exec(masked)
    if (a && !KEYWORDS.has((a[1] ?? '').toLowerCase())) pos = aliasRe.lastIndex
    const rest = /^\s*,\s*/.exec(masked.slice(pos))
    if (!commas || !rest) break
    pos += rest[0].length
  }
  return names
}

function inFunctionForm(masked: string, at: number): boolean {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = masked[i]
    if (c === ')') depth++
    else if (c === '(') {
      if (depth === 0) {
        const w = /([\w$]+)\s*$/.exec(masked.slice(0, i))
        return !!w && FUNCTION_FORMS.has((w[1] ?? '').toLowerCase())
      }
      depth--
    }
  }
  return false
}

function listsAfter(masked: string, re: RegExp, commas: boolean): string[] {
  return [...masked.matchAll(re)].flatMap((m) =>
    parseList(masked, (m.index ?? 0) + m[0].length, commas),
  )
}

function readsIn(masked: string): string[] {
  const ctes = ctesIn(masked)
  const out: string[] = []
  for (const m of masked.matchAll(/\b(from|join)\s+/gi)) {
    const at = m.index ?? 0
    const before = masked.slice(0, at)
    if (/\bdelete\s+$/i.test(before) || /\bdistinct\s+$/i.test(before)) continue
    if (inFunctionForm(masked, at)) continue
    out.push(...parseList(masked, at + m[0].length, (m[1] ?? '').toLowerCase() === 'from'))
  }
  if (/\b(delete\s+from|merge\s+into)\b/i.test(masked)) {
    out.push(...listsAfter(masked, /\busing\s+/gi, true))
  }
  return out.filter((n) => !ctes.has(n))
}

function writesIn(masked: string): string[] {
  const out: string[] = []
  for (const re of [UPDATE_RE, DELETE_RE, INSERT_RE, MERGE_RE]) {
    for (const m of masked.matchAll(re)) {
      const n = normName(m[1] ?? '')
      if (n !== 'set') out.push(n)
    }
  }
  out.push(...listsAfter(masked, TRUNCATE_RE, true))
  return out
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)]
}

export function tablesWritten(sql: string): string[] {
  return unique(splitStmts(sql).flatMap((s) => writesIn(s.masked)))
}

export function tablesRead(sql: string): string[] {
  return unique(splitStmts(sql).flatMap((s) => readsIn(s.masked)))
}

/** Writer calls in a SELECT; `writers` is the configured pattern (default: the estate's list). */
export function writerCalls(sql: string, writers: RegExp | null = WRITER_RE): string[] {
  if (writers === null) return []
  const calls: string[] = []
  for (const s of splitStmts(sql)) {
    for (const m of s.masked.matchAll(writers)) {
      if (/\bselect\b/i.test(s.masked.slice(0, m.index ?? 0))) calls.push(normName(m[1] ?? ''))
    }
  }
  return unique(calls)
}
