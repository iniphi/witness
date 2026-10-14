// Cross-session routines (1.9, ruled by Bradley 2026-10-11, "Cross-session routines"). Under the
// two-session rule a SKILL jewel could almost never mint: a skill comes from a routine that works
// (a repeated sequence of calls), which the witness saw only in THIS session's call digest, while
// only failures were read from every session. So each session keeps a compact digest of its own
// routines in a slot of its own, exactly as friction does (frictionslots.ts): it writes ONLY its
// own slot `routines:<project>:<session id>`, every session reads them all, and a slot nobody has
// touched for a day is folded into an archive key and deleted at the next start, so the store
// stays bounded.
//
// What a slot holds is a normalised HEAD per kind of call, with how often and in how many turns:
// the command's first word (and a subcommand of a known tool such as `git commit`), an MCP tool's
// name, a file tool's name with the file's extension. Never an argument, a path, a file's
// contents, SQL or prompt text. Pure.

import type { Observed } from '../types'
import { sessionTag } from './notes'

/** One kind of call a session made: its head, how many calls, and in how many distinct turns. */
export type RoutineEntry = { head: string; count: number; turns: number }

/** One session's routines, under `routines:<project>:<session id>`. */
export type RoutineSlot = { v: 1; sessionId: string; savedAt: number; entries: RoutineEntry[] }

/** The heads a slot keeps: the most frequent. */
export const ROUTINES_PER_SLOT = 60
/** The heads held in memory while a session runs, before the slot's cap. */
export const ROUTINES_IN_MEMORY = 200
/** Folded sessions kept in the archive: the newest. */
export const ROUTINE_ARCHIVE_SESSIONS = 20
/** A slot untouched this long is folded into the archive at the next start. */
export const ROUTINE_ARCHIVE_MS = 24 * 60 * 60_000
/** The shared routines the candidate pass is shown, at most. */
export const MAX_SHARED_ROUTINES = 30

export const routinesPrefix = (project: string): string => `routines:${project}:`
export const routinesArchiveKey = (project: string): string => `routines:${project}`
export const routinesSlotKey = (project: string, sessionId: string): string => `${routinesPrefix(project)}${sessionId}`

const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Monitor'])
const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'])
/** Commands whose second word is a subcommand (`git commit`), never an argument. */
const SUBCOMMAND_TOOLS: ReadonlySet<string> = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'gh', 'docker', 'claude', 'netlify', 'railway', 'supabase', 'cargo', 'pip', 'gcloud', 'kubectl', 'uv',
])
const COMMAND_WORD = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/
const SUBCOMMAND_WORD = /^[a-z][a-z-]{1,15}$/
const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/
/** What a stored head may look like at all: words, a dot and spaces. Anything else is not a head. */
const SAFE_HEAD = /^[A-Za-z0-9_. -]{1,90}$/
const LEADING_CD = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/
const LEADING_ENV = /^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+/

function shellHead(text: string): string {
  let t = text
  for (let i = 0; i < 4 && LEADING_CD.test(t); i++) t = t.replace(LEADING_CD, '')
  for (let i = 0; i < 4 && LEADING_ENV.test(t); i++) t = t.replace(LEADING_ENV, '')
  const first = (t.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? '').trim()
  const words = first.split(/\s+/).filter(w => w !== '')
  const word = (words[0] ?? '').replace(/^["']|["']$/g, '')
  if (word === '') return 'shell'
  if (/[\\/]/.test(word) || word.startsWith('.')) return 'script'
  if (!COMMAND_WORD.test(word)) return 'shell'
  const head = word.toLowerCase()
  const sub = words[1] ?? ''
  return SUBCOMMAND_TOOLS.has(head) && SUBCOMMAND_WORD.test(sub) ? `${head} ${sub}` : head
}

/**
 * A call as its normalised head. A shell call: the command's first word, plus a subcommand for a
 * known tool (`git commit`); a path, a flag, a hash, an id or a literal is never kept. An MCP tool:
 * its name. A file tool: the tool and the file's extension (`Edit .ts`), not its path. Any other
 * tool: its name. `input` is the call's text as the witness observed it.
 */
export function normaliseHead(tool: string, input: string): string {
  if (SHELLS.has(tool)) return shellHead(input)
  const name = TOOL_NAME.test(tool) ? tool : 'tool'
  if (FILE_TOOLS.has(tool)) {
    const text = input.trim()
    const quoted = /^(["'])(.*?)\1/.exec(text)
    const path = quoted !== null ? (quoted[2] ?? '') : (text.split(/\s+/)[0] ?? '')
    const ext = /\.([A-Za-z0-9]{1,6})$/.exec(path)
    return ext === null ? name : `${name} .${ext[1]!.toLowerCase()}`
  }
  return name
}

/** An entry in memory also remembers the turn it last saw, to count distinct turns; never stored. */
export type LiveRoutine = RoutineEntry & { last?: string }

/**
 * One main-session call noted: its head counts one more call, and one more turn when the turn
 * differs from the head's last. The newest ROUTINES_IN_MEMORY most frequent heads are kept.
 */
export function noteRoutine(entries: readonly LiveRoutine[], o: Pick<Observed, 'tool' | 'input' | 'turn'>): LiveRoutine[] {
  const head = normaliseHead(o.tool, o.input)
  const had = entries.find(e => e.head === head)
  const next: LiveRoutine =
    had === undefined
      ? { head, count: 1, turns: 1, ...(o.turn === undefined ? {} : { last: o.turn }) }
      : {
          head,
          count: had.count + 1,
          turns: had.turns + (o.turn !== undefined && o.turn !== had.last ? 1 : 0),
          ...(o.turn === undefined ? (had.last === undefined ? {} : { last: had.last }) : { last: o.turn }),
        }
  const all = [...entries.filter(e => e.head !== head).map(e => ({ ...e })), next]
  return all.length <= ROUTINES_IN_MEMORY ? all : mostFrequent(all, ROUTINES_IN_MEMORY)
}

function mostFrequent<T extends RoutineEntry>(entries: readonly T[], max: number): T[] {
  return [...entries].sort((a, b) => b.count - a.count || a.head.localeCompare(b.head)).slice(0, max)
}

/** What this session writes to its own slot: the 60 most frequent heads, heads and counts only. */
export function routineSlot(o: { sessionId: string; savedAt: number; entries: readonly RoutineEntry[] }): RoutineSlot {
  const entries = mostFrequent(o.entries, ROUTINES_PER_SLOT).map(e => ({ head: e.head, count: e.count, turns: e.turns }))
  return { v: 1, sessionId: o.sessionId, savedAt: o.savedAt, entries }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

const asEntry = (v: unknown): RoutineEntry | null => {
  if (v === null || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.head !== 'string' || !SAFE_HEAD.test(e.head) || !isInt(e.count) || !isInt(e.turns)) return null
  return { head: e.head, count: e.count, turns: e.turns }
}

/** A stored slot read back; null for anything else. Entries that are not a plain head are dropped. */
export function asRoutineSlot(v: unknown): RoutineSlot | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.v !== 1 || typeof o.sessionId !== 'string' || o.sessionId === '' || typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
  const entries = Array.isArray(o.entries) ? o.entries.map(asEntry).filter((e): e is RoutineEntry => e !== null) : []
  return routineSlot({ sessionId: o.sessionId, savedAt: o.savedAt, entries })
}

/** The archive read back: a list of slots, malformed ones dropped. */
export const asRoutineArchive = (v: unknown): RoutineSlot[] =>
  Array.isArray(v) ? v.map(asRoutineSlot).filter((s): s is RoutineSlot => s !== null) : []

/** Whether a slot is folded into the archive: another session's, untouched for a day. */
export const routineArchivable = (slot: RoutineSlot, now: number, self: string): boolean =>
  slot.sessionId !== self && now - slot.savedAt > ROUTINE_ARCHIVE_MS

/** The archive with these slots folded in: one slot per session (the newest), the newest sessions kept. */
export function foldRoutines(archive: readonly RoutineSlot[], folded: readonly RoutineSlot[]): RoutineSlot[] {
  return slotsBySession([...archive, ...folded])
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(-ROUTINE_ARCHIVE_SESSIONS)
}

/** Several slot lists as one slot per session; for a session in more than one, the newest wins. */
export function slotsBySession(slots: readonly RoutineSlot[]): RoutineSlot[] {
  const by = new Map<string, RoutineSlot>()
  for (const s of slots) {
    const had = by.get(s.sessionId)
    if (had === undefined || s.savedAt >= had.savedAt) by.set(s.sessionId, { ...s, entries: s.entries.map(e => ({ ...e })) })
  }
  return [...by.values()]
}

/**
 * The routine heads that appear in two or more sessions, as lines for the candidate pass, each with
 * the session tags it was seen in and how often: `- git commit: [s3f2a] 12 calls in 5 turns; [s9c41]
 * 3 calls in 2 turns`. Most sessions first, then most calls. Session ids never appear, only tags.
 */
export function sharedRoutines(slots: readonly RoutineSlot[], max = MAX_SHARED_ROUTINES): string[] {
  const by = new Map<string, Array<{ tag: string; count: number; turns: number }>>()
  for (const s of slotsBySession(slots)) {
    for (const e of s.entries) {
      by.set(e.head, [...(by.get(e.head) ?? []), { tag: sessionTag(s.sessionId), count: e.count, turns: e.turns }])
    }
  }
  const shared = [...by.entries()].filter(([, v]) => new Set(v.map(x => x.tag)).size >= 2)
  const calls = (v: ReadonlyArray<{ count: number }>): number => v.reduce((n, x) => n + x.count, 0)
  shared.sort((a, b) => b[1].length - a[1].length || calls(b[1]) - calls(a[1]) || a[0].localeCompare(b[0]))
  return shared.slice(0, max).map(([head, v]) => {
    const seen = v.map(x => `[s${x.tag}] ${x.count} ${x.count === 1 ? 'call' : 'calls'} in ${x.turns} ${x.turns === 1 ? 'turn' : 'turns'}`)
    return `- ${head}: ${seen.join('; ')}`
  })
}
