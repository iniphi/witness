// The core/estate split (1.0, ruled 2026-10-09): one source that runs in the iniphi
// estate unchanged and in a Claude Code with no estate at all. Every estate-specific
// input is a userConfig field, and each adapter is off when its input is absent.
// SUPERSEDED IN PART (ruled by Bradley 2026-10-11): the 1.0 clause
// "whose default keeps the estate working with no configuration" no longer holds. The
// public defaults are neutral (no workspace.* names, no Supabase assumption) and the
// estate supplies its own values through its local config (writerCalls, and sqlTools if
// its database tool does not end in __execute_sql). Pure: register.tsx does the file
// checks; what can be decided from plain data lives here.

export const TICKET_SCRIPT = 'scripts/estate-status.py'
export const WATCH_SCRIPT = 'scripts/witness-watch.py'
/** No writer functions by default (neutral, 2026-10-11): a SELECT is a read unless the user lists the functions that write. */
export const DEFAULT_WRITERS: readonly string[] = []
/**
 * The tools whose `query` input is SQL the hold judges. Neutral default: any MCP tool whose
 * name ends `__execute_sql`, a convention several database servers share (not Supabase-only).
 */
export const DEFAULT_SQL_TOOLS = ['mcp__*__execute_sql'] as const
/** The schemas whose tables a subagent's report may name; neutral: `public` only. */
export const DEFAULT_TABLE_SCHEMAS = ['public'] as const
export const DEFAULT_SESSIONS_DIR = '.claude/sessions'
export const DEFAULT_GOALS_HEADING = '## Goals'
export const DEFAULT_CLOSE_COMMANDS = ['/close'] as const
export const DEFAULT_PERSON = 'you'
/** The estate's run-a-board skill; named in /tackle only where the estate is present. */
export const ESTATE_TACKLE_SKILL = '/agile'
/** How far above the mod's folder a default script is looked for (mods/<mod> -> repo root). */
export const SCRIPT_LEVELS = 3

export type Config = {
  ticketScript: string
  watchScript: string
  writers: readonly string[]
  /** Tool-name patterns of the SQL tools the hold judges (`*` matches any run of characters). */
  sqlTools: readonly string[]
  /** Schemas whose `schema.table` names in a subagent's report count as targets it named. */
  tableSchemas: readonly string[]
  person: string
  sessionsDir: string
  goalsHeading: string
  closeCommands: readonly string[]
  /** The sonar (1.2): `auto` runs it where the estate is present, `on` always, `off` never. */
  sonar: SonarSetting
  /** Typed hands (1.3.3): `auto` starts work where the estate is present, `start` always, `wait` never. */
  typedHands: TypedHandsSetting
  /** The blush (1.7): the database has point-in-time recovery, so a bulk loss is rung 2, not 3. Unknown is false. */
  pointInTimeRecovery: boolean
  /** The haemorrhage (1.7): rows back from a statement that named fewer, above which the creature goes red. */
  haemorrhageRows: number
  /** The lamp test (1.7): the creature shows red for 1.5 s at session start. */
  lampTest: boolean
  /** Tables whose writes can reach outside the database (1.7); `*` matches any run of characters. Default none. */
  effectTables: readonly string[]
}

export const DEFAULT_HAEMORRHAGE_ROWS = 25

/** A number, or a numeric string, that is a whole count of at least 1; else the fallback. */
export function countOf(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : fallback
}

/** A boolean option, or the strings true/false; else the fallback. */
export function flagOf(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

export type SonarSetting = 'auto' | 'on' | 'off'
export type TypedHandsSetting = 'auto' | 'start' | 'wait'

/** Whether this load runs the sonar: heartbeats, overlaps and hands write files under ~/.claude/state. */
export function sonarOn(setting: SonarSetting, estate: boolean): boolean {
  return setting === 'on' || (setting === 'auto' && estate)
}

/**
 * Whether a hand typed in another session may start work here unattended (ruled 2026-10-09).
 * A hand is taken on the engine's plugin stamp, which its own types call only the sender's
 * claim, so by default (no estate) a typed hand waits for Enter like a Claude-written one.
 */
export function typedHandsStart(setting: TypedHandsSetting, estate: boolean): boolean {
  return setting === 'start' || (setting === 'auto' && estate)
}

/** The adapters found at session start: null is off. */
export type Adapters = { ticket: string | null; watch: string | null }

export const NO_ADAPTERS: Adapters = { ticket: null, watch: null }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A comma- or newline-separated list, blanks dropped. */
export function listOf(v: unknown): string[] {
  return text(v)
    .split(/[,\n]/)
    .map(x => x.trim())
    .filter(x => x.length > 0)
}

export function readConfig(options: unknown): Config {
  const o = (options ?? {}) as Record<string, unknown>
  const writers = listOf(o.writerCalls)
  const close = listOf(o.closeCommands)
  const sqlTools = listOf(o.sqlTools)
  const schemas = listOf(o.tableSchemas).filter(n => /^[A-Za-z_]\w*$/.test(n))
  return {
    ticketScript: text(o.ticketScript),
    watchScript: text(o.watchScript),
    writers: writers.length > 0 ? writers : [...DEFAULT_WRITERS],
    sqlTools: sqlTools.length > 0 ? sqlTools : [...DEFAULT_SQL_TOOLS],
    tableSchemas: schemas.length > 0 ? schemas : [...DEFAULT_TABLE_SCHEMAS],
    person: text(o.person) || DEFAULT_PERSON,
    sessionsDir: text(o.sessionsDir) || DEFAULT_SESSIONS_DIR,
    goalsHeading: text(o.goalsHeading) || DEFAULT_GOALS_HEADING,
    closeCommands: close.length > 0 ? close : [...DEFAULT_CLOSE_COMMANDS],
    sonar: o.sonar === 'on' || o.sonar === 'off' ? o.sonar : 'auto',
    typedHands: o.typedHands === 'start' || o.typedHands === 'wait' ? o.typedHands : 'auto',
    pointInTimeRecovery: flagOf(o.pointInTimeRecovery, false),
    haemorrhageRows: countOf(o.haemorrhageRows, DEFAULT_HAEMORRHAGE_ROWS),
    lampTest: flagOf(o.lampTest, true),
    effectTables: listOf(o.effectTables),
  }
}

export function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(path)
}

/** Forward slashes, `.` and `..` segments resolved, no trailing slash. */
export function normalizePath(path: string): string {
  const raw = path.replace(/\\/g, '/')
  const lead = raw.startsWith('/') ? '/' : ''
  const parts = raw.split('/').reduce<string[]>((acc, seg) => {
    if (seg === '' || seg === '.') return acc
    if (seg !== '..') return [...acc, seg]
    const last = acc[acc.length - 1]
    // Never above a root: `/..` and `C:/..` stay at the root; a relative path keeps its `..`.
    if (last === undefined) return lead === '/' ? acc : [...acc, seg]
    if (/^[A-Za-z]:$/.test(last)) return acc
    return last === '..' ? [...acc, seg] : acc.slice(0, -1)
  }, [])
  return `${lead}${parts.join('/')}`
}

/** `rel` under `base`, unless `rel` is absolute. */
export function under(base: string, rel: string): string {
  return normalizePath(isAbsolute(rel) ? rel : `${base}/${rel}`)
}

/**
 * The mod's folder from its hooks module's own `import.meta.url`, a second word on where
 * the mod is for when the engine's `$.plugin.root` is blank (the estate line vanished for a
 * morning on 2026-10-09 when it was): `file:///C:/x/mods/witness/hooks/register.tsx` gives
 * `C:/x/mods/witness`, and so does the POSIX form. '' for anything that is not a file URL
 * of a module under a `hooks/` folder.
 */
export function rootFromModuleUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('file://')) return ''
  const path = decodeURIComponent(url.slice('file://'.length))
  const local = /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  const m = /^(.+)\/hooks\/[^/]+$/.exec(local)
  return m === null ? '' : normalizePath(m[1] ?? '')
}

/**
 * Where to look for a script, in order. A configured path is the only candidate
 * (relative to the session's folder); unset, `rel` under the mod's own folder and up
 * to SCRIPT_LEVELS folders above it, so the mod's own repository supplies it (in the
 * estate, <repo>/mods/witness -> <repo>/scripts). Never the session's
 * folder by default: a repo opened is not trusted to run a script on every start.
 */
export function scriptCandidates(configured: string, pluginRoot: string, cwd: string, rel: string): string[] {
  if (configured !== '') return [under(cwd, configured)]
  if (pluginRoot === '') return []
  return Array.from({ length: SCRIPT_LEVELS }, (_, i) => under(pluginRoot, `${'../'.repeat(i)}${rel}`))
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `schema.name` or `name`; a trailing `*` matches any further name characters. */
function writerSource(name: string): string {
  const star = name.endsWith('*')
  const parts = (star ? name.slice(0, -1) : name).split('.').map(p => escape(p.trim()))
  return `${parts.join('\\s*\\.\\s*')}${star ? '[a-z_0-9]*' : ''}`
}

/** The pattern sql.ts matches writer calls with; null when the list is empty. */
export function writerPattern(names: readonly string[]): RegExp | null {
  const valid = names.filter(n => /^[A-Za-z_][\w.]*\*?$/.test(n))
  if (valid.length === 0) return null
  return new RegExp(`\\b(${valid.map(writerSource).join('|')})\\s*\\(`, 'gi')
}

/** The pattern a tool name must match whole to be a SQL tool; `*` anywhere is a wildcard. Null when no entry is usable. */
export function sqlToolPattern(names: readonly string[]): RegExp | null {
  const valid = names.filter(n => /^[\w$*-]+$/.test(n))
  if (valid.length === 0) return null
  return new RegExp(`^(?:${valid.map(n => n.split('*').map(escape).join('.*')).join('|')})$`)
}

/**
 * The pattern a written table's name must match whole (lower-case) to be an effect table (1.7).
 * `*` is a wildcard anywhere. An entry with no schema (`orders`) also matches that table in any
 * schema. Null when the list is empty or holds nothing usable.
 */
export function effectTablePattern(names: readonly string[]): RegExp | null {
  const valid = names.map(n => n.trim().toLowerCase()).filter(n => /^[\w$*.]+$/.test(n))
  if (valid.length === 0) return null
  const source = (n: string): string => {
    const body = n.split('*').map(escape).join('.*')
    return n.includes('.') ? body : `(?:[\\w$]+\\.)?${body}`
  }
  return new RegExp(`^(?:${valid.map(source).join('|')})$`)
}

/** Whether a tool name is one of the configured SQL tools. */
export function isSqlTool(tool: unknown, pattern: RegExp | null): boolean {
  return typeof tool === 'string' && pattern !== null && pattern.test(tool)
}

export function isCloseCommand(prompt: string, commands: readonly string[]): boolean {
  const t = prompt.trim()
  return commands.some(c => t === c || t.startsWith(`${c} `) || t.startsWith(`${c}\n`))
}

/** The person as the model reads it: "the user" by default, else the configured name. */
export function personRef(person: string): string {
  return person === DEFAULT_PERSON ? 'the user' : person
}

/** Whose words called an ask off, as the print and the confirm tool say it. */
export function onWords(person: string): string {
  return person === DEFAULT_PERSON ? 'on your words' : `on ${person}'s words`
}
