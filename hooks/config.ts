// The core/estate split (1.0, ruled 2026-10-09): one source that runs in the iniphi
// estate unchanged and in a Claude Code with no estate at all. Every estate-specific
// input is a userConfig field whose default keeps the estate working with no
// configuration, and each adapter is off when its input is absent. Pure: register.tsx
// does the file checks; what can be decided from plain data lives here.

export const TICKET_SCRIPT = 'scripts/estate-status.py'
export const WATCH_SCRIPT = 'scripts/witness-watch.py'
/** The estate's SELECT-led write functions; harmless where that schema does not exist. */
export const DEFAULT_WRITERS = [
  'workspace.close_todo',
  'workspace.set_todo_status',
  'workspace.pause_todo',
  'workspace.crosstalk_*',
  'workspace.record_board_attention',
  'workspace.claim_item',
  'workspace.release_claim',
] as const
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
  person: string
  sessionsDir: string
  goalsHeading: string
  closeCommands: readonly string[]
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
  return {
    ticketScript: text(o.ticketScript),
    watchScript: text(o.watchScript),
    writers: writers.length > 0 ? writers : [...DEFAULT_WRITERS],
    person: text(o.person) || DEFAULT_PERSON,
    sessionsDir: text(o.sessionsDir) || DEFAULT_SESSIONS_DIR,
    goalsHeading: text(o.goalsHeading) || DEFAULT_GOALS_HEADING,
    closeCommands: close.length > 0 ? close : [...DEFAULT_CLOSE_COMMANDS],
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
