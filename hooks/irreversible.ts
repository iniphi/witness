// The safelight blush's reading (1.7, Bradley 2026-10-11): how far can a call's EFFECTS be undone,
// and by whom. The rung is read from what the call CONTAINS, never from the tool: a reverting
// migration restores the schema, not the rows a DROP took (the Ammonite's first objection), and an
// undone row does not undo what a trigger on it already sent (its second). So the witness names
// only effects it has a register for (the ticket's metered verdict, the effectTables setting) and
// says "not checked" for the rest. Rung 1: you can undo it yourself, now. Rung 2: undoing it does
// not get everything back. Rung 3: nobody can undo it. Pure: plain data in, a verdict out.

import { shellCommands } from './classify'
import { DEFAULT_SQL_TOOLS, isSqlTool, sqlToolPattern } from './config'
import { maskSql } from './sql'

export type Rung = 1 | 2 | 3

export type Undo = {
  rung: Rung
  /** What the call does, in a few words: "DROP TABLE workspace.x". */
  what: string
  /** Who can undo it, and what stays done. Ends with an effects clause where one applies. */
  undo: string
}

export type UndoInput = {
  tool: string
  /** The call's input: `query` for SQL, `command` for a shell. */
  input: Record<string, unknown>
  /** The ticket's metered verdict word (METERED, UNMETERED, UNKNOWN, NO REGISTER); null when there is no ticket. */
  push: string | null
  /** The database has point-in-time recovery (config); unknown is false, which fails closed to rung 3. */
  pitr: boolean
  /** The configured SQL tools, as classify takes them; absent, any `mcp__*__execute_sql`. */
  sqlTools?: RegExp | null
  /** Tables whose writes can reach outside the database (config effectTables); null: none listed. */
  effectTables?: RegExp | null
}

const DEFAULT_SQL_PATTERN = sqlToolPattern(DEFAULT_SQL_TOOLS)
const MIGRATION_TOOL = /__apply_migration$/
const MAIL_TOOL = /__(send_message|reply|forward)$/

const NAME = '[\\w$]+(?:\\s*\\.\\s*[\\w$]+)*'
const UPDATE_RE = new RegExp(`\\bupdate\\s+(?:only\\s+)?(${NAME})(?:\\s+(?:as\\s+)?[\\w$]+)?\\s+set\\b`, 'gi')
const DELETE_RE = new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?(${NAME})`, 'gi')
const INSERT_RE = new RegExp(`\\binsert\\s+into\\s+(${NAME})`, 'gi')
const DROP_RE = new RegExp(`^\\s*drop\\s+(table|schema|view|materialized\\s+view|function|column)\\s+(?:if\\s+exists\\s+)?(${NAME})?`, 'i')
const TRUNCATE_RE = new RegExp(`^\\s*truncate\\s+(?:table\\s+)?(?:only\\s+)?(${NAME})?`, 'i')
const ALTER_RE = new RegExp(`^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${NAME})`, 'i')
const ADDITIVE_RE = /^\s*(?:create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|index|view|materialized\s+view|function|policy|trigger|schema|extension|type|sequence)\b|comment\s+on\b|grant\b)/i
const OPAQUE_RE = /^\s*(?:do|call)\b/i

// A WHERE that is one equality on one literal: `id = 'x'`, `7 = id`, `id = 'x'::uuid`. Strings are masked blank.
// Group 1 is the column when it leads, group 2 when the literal does.
const PINNED_RE = /^\s*(?:(?:[\w$]+\s*\.\s*)?([\w$]+)\s*=\s*(?:'[^']*'|-?\d+(?:\.\d+)?)(?:\s*::\s*[\w$]+)?|(?:'[^']*'|-?\d+)\s*=\s*(?:[\w$]+\s*\.\s*)?([\w$]+))\s*$/i
// The witness cannot see UNIQUE indexes, so a key is a column that is named like one.
const KEY_COLUMN = /^(?:[\w$]*_)?(?:id|uuid|pk|key|slug)$/i
const IN_LIST_RE = /^\s*(?:[\w$]+\s*\.\s*)?[\w$]+\s+in\s*\(([^()]*)\)\s*$/i

const normName = (raw: string): string => raw.replace(/\s+/g, '').toLowerCase()
const upper = (s: string): string => s.toUpperCase().replace(/\s+/g, ' ')

/** One UPDATE or DELETE found in a statement. */
export type WriteInfo = {
  verb: 'UPDATE' | 'DELETE'
  table: string
  /** The WHERE clause, masked; null when there is none. */
  where: string | null
  returning: boolean
}

/** The text of a statement from `from` to the `)` that closes a CTE body it sits in, or its end. */
function bodyFrom(masked: string, from: number): string {
  let depth = 0
  for (let i = from; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')' && --depth < 0) return masked.slice(from, i)
  }
  return masked.slice(from)
}

function writesIn(masked: string): WriteInfo[] {
  const out: WriteInfo[] = []
  const scan = (re: RegExp, verb: WriteInfo['verb']): void => {
    for (const m of masked.matchAll(re)) {
      const at = m.index ?? 0
      const table = normName(m[1] ?? '')
      if (table === 'set' || /\bdo\s+$/i.test(masked.slice(0, at))) continue
      const body = bodyFrom(masked, at)
      const w = /\bwhere\b([\s\S]*?)(?:\breturning\b|$)/i.exec(body)
      out.push({ verb, table, where: w === null ? null : (w[1] ?? '').trim(), returning: /\breturning\b/i.test(body) })
    }
  }
  scan(UPDATE_RE, 'UPDATE')
  scan(DELETE_RE, 'DELETE')
  return out
}

const maskedStatements = (sql: string): string[] =>
  maskSql(sql).split(';').filter((s) => s.trim() !== '')

/** How many rows a WHERE names: 1 for a single key, the length of a literal `IN (...)` list, else 1. */
export function rowsNamed(where: string | null): number {
  if (where === null) return 1
  const list = IN_LIST_RE.exec(where)
  if (list === null || /\bselect\b/i.test(list[1] ?? '')) return 1
  const items = (list[1] ?? '').split(',').filter((x) => x.trim() !== '')
  return Math.max(1, items.length)
}

/** Every UPDATE or DELETE in the SQL that carries RETURNING, with how many rows it named. */
export function returningWrites(sql: string): Array<{ verb: 'UPDATE' | 'DELETE'; table: string; named: number }> {
  return maskedStatements(sql)
    .flatMap(writesIn)
    .filter((w) => w.returning)
    .map((w) => ({ verb: w.verb, table: w.table, named: rowsNamed(w.where) }))
}

/** One row, as far as the text shows: RETURNING, and a WHERE that is one equality on a key-named column. */
function isPinned(w: WriteInfo): boolean {
  if (w.where === null || !w.returning) return false
  const m = PINNED_RE.exec(w.where)
  return m !== null && KEY_COLUMN.test(m[1] ?? m[2] ?? '')
}

type Item = Undo & { table: string | null }
type Reading = Item | 'additive' | null

type Ctx = { pitr: boolean; effectTables: RegExp | null; migration: boolean }

/** The effects clause for a write to `table`, and the rung it cannot fall below. */
function effectsOf(table: string, ctx: Ctx): { floor: Rung; clause: string } {
  if (ctx.effectTables !== null && ctx.effectTables.test(table)) {
    return {
      floor: 2,
      clause: `a trigger on ${table} can reach outside the database; undoing the row does not undo what it sent (effectTables)`,
    }
  }
  return { floor: 1, clause: `triggers on ${table} are not in effectTables` }
}

const lossRung = (ctx: Ctx): Rung => (ctx.pitr ? 2 : 3)

function lossUndo(ctx: Ctx, what: string): string {
  return ctx.pitr
    ? 'only a point-in-time restore brings the rows back, and it restores the whole project'
    : `a reverting migration brings back the schema, not ${what}`
}

function withEffects(item: Omit<Item, 'table'>, table: string, ctx: Ctx): Item {
  const fx = effectsOf(table, ctx)
  return { rung: Math.max(item.rung, fx.floor) as Rung, what: item.what, undo: `${item.undo}; ${fx.clause}`, table }
}

function readWrite(w: WriteInfo, ctx: Ctx): Item {
  if (isPinned(w)) {
    return withEffects(
      {
        rung: 1,
        what: `${w.verb} one row in ${w.table}`,
        undo: `one row in ${w.table}: RETURNING shows it as it is now; to undo, write its old values back`,
      },
      w.table,
      ctx,
    )
  }
  const lost = w.verb === 'DELETE' ? `the rows in ${w.table}` : `the old values in ${w.table}`
  return withEffects(
    { rung: lossRung(ctx), what: `${w.verb} not pinned to one row in ${w.table}`, undo: lossUndo(ctx, lost) },
    w.table,
    ctx,
  )
}

function readStatement(masked: string, ctx: Ctx): Reading[] {
  const loss = (what: string, target: string): Item => ({ rung: lossRung(ctx), what, undo: lossUndo(ctx, `the rows in ${target}`), table: null })
  const drop = DROP_RE.exec(masked)
  if (drop !== null) {
    const kind = upper(drop[1] ?? '')
    const name = normName(drop[2] ?? '') || 'the database'
    return [loss(`DROP ${kind} ${name}`.trim(), name)]
  }
  const trunc = TRUNCATE_RE.exec(masked)
  if (trunc !== null) {
    const name = normName(trunc[1] ?? '') || 'the database'
    return [withEffects({ rung: lossRung(ctx), what: `TRUNCATE ${name}`, undo: lossUndo(ctx, `the rows in ${name}`) }, name, ctx)]
  }
  const alter = ALTER_RE.exec(masked)
  if (alter !== null) {
    const table = normName(alter[1] ?? '')
    const col = /\bdrop\s+column\s+(?:if\s+exists\s+)?([\w$]+)/i.exec(masked) ?? /\bdrop\s+(?!constraint\b|default\b|not\b|identity\b|expression\b|column\b)([\w$]+)/i.exec(masked)
    if (col !== null) return [loss(`ALTER TABLE ${table} DROP COLUMN ${col[1] ?? ''}`, `${table}.${col[1] ?? ''}`)]
    return /\badd\b/i.test(masked) ? ['additive'] : [null]
  }
  if (ADDITIVE_RE.test(masked)) return ['additive']
  if (ctx.migration && OPAQUE_RE.test(masked)) return [loss('a DO or CALL block the witness cannot read', 'the database')]
  const writes = writesIn(masked).map((w) => readWrite(w, ctx))
  const inserts = [...masked.matchAll(INSERT_RE)]
    .map((m) => normName(m[1] ?? ''))
    .filter((t) => ctx.effectTables !== null && ctx.effectTables.test(t))
    .map((t): Item => ({ rung: 2, what: `INSERT into ${t}`, undo: effectsOf(t, ctx).clause, table: t }))
  return [...writes, ...inserts]
}

const worst = (items: Item[]): Item | null =>
  items.reduce<Item | null>((best, i) => (best === null || i.rung > best.rung ? i : best), null)

function sqlUndo(query: unknown, name: unknown, ctx: Ctx): Undo | null {
  if (typeof query !== 'string' || query.trim() === '') return null
  const readings = maskedStatements(query).flatMap((s) => readStatement(s, ctx))
  const hit = worst(readings.filter((r): r is Item => r !== null && r !== 'additive'))
  const added = readings.some((r) => r === 'additive')
  if (hit !== null) return { rung: hit.rung, what: hit.what, undo: hit.undo }
  if (ctx.migration && added) {
    const label = typeof name === 'string' && name.trim() !== '' ? `migration ${name.trim()}` : 'a migration'
    return { rung: 1, what: `${label} (additive only)`, undo: 'a reverting migration takes out what this added' }
  }
  return null
}

const FORCE = /^--force(?:-with-lease(?:=.*)?|-if-includes)?$/
const SHORT_FORCE = /^-[A-Za-z]*f[A-Za-z]*$/

function pushRung(args: string[], push: string | null): Undo | null {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  if ((args[i] ?? '').toLowerCase() !== 'push') return null
  const rest = args.slice(i + 1)
  if (rest.some((a) => a === '--dry-run' || a === '-n')) return null
  const forced = rest.some((a) => FORCE.test(a) || SHORT_FORCE.test(a) || (a.length > 1 && a.startsWith('+')))
  if (forced) {
    return {
      rung: 3,
      what: 'git push --force',
      undo: 'the commits it replaced are gone from the remote; only a clone that still has them can restore them',
    }
  }
  if (push === 'METERED') {
    return {
      rung: 2,
      what: 'git push',
      undo: 'a revert commit undoes the code, and costs a second build; the build it started is not undone (metered register)',
    }
  }
  if (push === 'UNMETERED') {
    return {
      rung: 1,
      what: 'git push',
      undo: 'a revert commit undoes the code, not what anyone already pulled; no build is registered behind this repo (metered register)',
    }
  }
  return {
    rung: 2,
    what: 'git push',
    undo: 'a revert commit undoes the code, not what anyone already pulled; builds and webhooks behind this repo: not checked',
  }
}

function shellUndo(command: unknown, push: string | null): Undo | null {
  if (typeof command !== 'string') return null
  const pushes = shellCommands(command)
    .filter((c) => c.name === 'git')
    .map((c) => pushRung(c.args, push))
    .filter((u): u is Undo => u !== null)
  return pushes.reduce<Undo | null>((best, u) => (best === null || u.rung > best.rung ? u : best), null)
}

/**
 * How far this call's effects can be undone, or null when it is not an irreversible call of the
 * kinds read in v1 (SQL loss and bulk writes, additive migrations, git push, an outgoing email).
 * A statement set takes the rung of its worst statement.
 */
export function undoOf(i: UndoInput): Undo | null {
  const tool = typeof i.tool === 'string' ? i.tool : ''
  const mail = MAIL_TOOL.exec(tool)
  if (mail !== null && /gmail/i.test(tool)) {
    return { rung: 3, what: `an email ${(mail[1] ?? '').replace('_message', '')}`, undo: 'sent: nobody can unsend it' }
  }
  if (tool === 'Bash' || tool === 'PowerShell') return shellUndo(i.input.command, i.push)
  const migration = MIGRATION_TOOL.test(tool)
  if (migration || isSqlTool(tool, i.sqlTools === undefined ? DEFAULT_SQL_PATTERN : i.sqlTools)) {
    return sqlUndo(i.input.query, i.input.name, { pitr: i.pitr, effectTables: i.effectTables ?? null, migration })
  }
  return null
}
