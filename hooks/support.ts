// Pure helpers for register.tsx. The engine follows `$` only into functions of the
// hooks module's own file, so everything that calls `$` lives there; what can be
// decided from plain data lives here, where tests reach it.

import type { Ask, Ledger } from '../types'
import { PRINT_END, cleanText, counts } from './asks'
import {
  DEFAULT_CLOSE_COMMANDS,
  DEFAULT_PERSON,
  DEFAULT_SESSIONS_DIR,
  ESTATE_TACKLE_SKILL,
  isCloseCommand as isConfiguredClose,
  personRef,
  under,
} from './config'
import { CONFIRM_TOOL } from './evidence'
import { paleCount } from './witness'

export const HELPER_TIMEOUT_MS = 45_000
export const SIDE_PASS = { model: 'haiku', effort: 'low', timeoutMs: 20_000 } as const
export const PRINT_HEADING = '## Witness print'
export const LOG_SCAN = 6
/** A log touched this long before the session's start still counts (the log is opened just before). */
export const LOG_GRACE_MS = 10 * 60_000

let seq = 0

/** Ids unique within the session: time, a counter, and a little noise. */
export function newIds(now: number, n: number, prefix: string): string[] {
  return Array.from({ length: n }, () => {
    seq += 1
    const noise = Math.random().toString(36).slice(2, 6)
    return `${prefix}${now.toString(36)}${seq.toString(36)}${noise}`
  })
}

/** The store key for a project: its folder, lower-case, forward slashes. */
export function projectKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function storeKeys(key: string): { carry: string; friction: string; barnacles: string; candidates: string } {
  return {
    carry: `carry:${key}`,
    friction: `friction:${key}`,
    barnacles: `barnacles:${key}`,
    candidates: `candidates:${key}`,
  }
}

/** The session-log folder: config `sessionsDir` under the session's folder (default .claude/sessions). */
export function sessionsDir(cwd: string, dir: string = DEFAULT_SESSIONS_DIR): string {
  return under(cwd, dir)
}

/** Text that may reach the session log or a prompt: one line, whitespace collapsed. */
export function askText(text: string): string {
  return cleanText(text)
}

/**
 * Session log names newest first (they are timestamped), at most LOG_SCAN, and only
 * those touched since this session started: a stale unclosed log, or another
 * project's, is not this session's (the Adversary found one unclosed for 17 days).
 */
export function logCandidates(
  entries: ReadonlyArray<{ name: string; kind: string; mtimeMs?: number }>,
  startedAt: number,
): string[] {
  return entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    .filter(f => typeof f.mtimeMs !== 'number' || f.mtimeMs >= startedAt - LOG_GRACE_MS)
    .map(f => f.name)
    .sort()
    .reverse()
    .slice(0, LOG_SCAN)
}

export function isOpenLog(text: string): boolean {
  return !text.includes('## Session Closed')
}

/** New asks from the side pass's texts; `source` 'build' for its multi-session list (0.6.0). */
export function freshAsks(
  texts: readonly string[],
  ids: readonly string[],
  at: number,
  source: 'ask' | 'build' = 'ask',
): Ask[] {
  return texts.map((text, i) => ({
    id: ids[i] ?? `a${at}-${i}`,
    text: cleanText(text),
    source,
    state: 'open',
    claimId: null,
    at,
  }))
}

/**
 * The asks a "done" answer may claim: open ones, and ticked goals still without a claim.
 * Never a build: a turn does not finish a multi-session build, and /close makes it a to-do.
 */
export function claimable(asks: readonly Ask[]): Ask[] {
  return asks.filter(
    a => a.source !== 'build' && (a.state === 'open' || (a.state === 'claimed' && a.claimId === null)),
  )
}

/**
 * Replaces the log's witness print, or appends one. The print ends with PRINT_END,
 * and only the text up to that marker is replaced, so notes written after a first
 * /wrap survive a second. A print without the marker (none should exist) is
 * replaced only up to the next heading.
 */
export function withPrint(text: string, section: string): string {
  const at = text.indexOf(PRINT_HEADING)
  if (at === -1) return `${text.replace(/\s*$/, '')}\n\n${section.trim()}\n`
  const marker = text.indexOf(PRINT_END, at)
  if (marker !== -1) {
    const tail = text.slice(marker + PRINT_END.length)
    return `${text.slice(0, at)}${section.trim()}${tail}`
  }
  const after = text.indexOf('\n## ', at + PRINT_HEADING.length)
  const tail = after === -1 ? '' : text.slice(after)
  return `${text.slice(0, at)}${section.trim()}\n${tail}`
}

/** The undone: open, or claimed but never witnessed. A build is not undone work for this session. */
export function undone(asks: readonly Ask[]): Ask[] {
  // Nor is an ask the close triage made a to-do (0.8.0): it lives on the board now.
  return asks.filter(
    a => a.source !== 'build' && a.settled === undefined && (a.state === 'open' || a.state === 'claimed'),
  )
}

/**
 * `/close` (Bradley, S162: "why on wrap and not on close as well?"): the close skill
 * reads the session log, so the companion writes its print there first, as /wrap does.
 */
export function isCloseCommand(text: string, commands: readonly string[] = DEFAULT_CLOSE_COMMANDS): boolean {
  return isConfiguredClose(text, commands)
}

/** The title every /tackle prompt opens with; its text is the companion's own list, never new asks. */
export const TACKLE_TITLE = 'Tackle the undone asks the witness holds for this session:'
/** The estate's first line: the title run as an /agile board (1.0: only where the estate is present). */
export const TACKLE_HEADER = `${ESTATE_TACKLE_SKILL} ${TACKLE_TITLE}`

/** The first line: the title, after the skill that runs it when one is named. */
export function tackleHeader(skill: string | null): string {
  return skill === null || skill === '' ? TACKLE_TITLE : `${skill} ${TACKLE_TITLE}`
}

/**
 * Whether a prompt is a /tackle run the companion wrote. Mining it re-recorded the
 * asks it lists as new ones (seen live S162: the three finished goals came back as
 * "Verify or finish ..." duplicates), so the side pass skips it.
 */
export function isTacklePrompt(text: string): boolean {
  return text.trim().replace(/^\/\S+\s+/, '').startsWith(TACKLE_TITLE)
}

/**
 * /tackle (Bradley, S162): the undone asks as an /agile run for this session to
 * direct. It goes into the prompt box for Bradley to read and send, never straight
 * to the model, and done still means witnessed. Null when nothing is undone.
 */
/**
 * The run opens with a sweep (Bradley, S163): much of what the witness holds is already
 * done and its evidence is often already in the context window, so dismissing on evidence
 * comes before slicing, and an agent is only for what survives it.
 */
export const SWEEP_FIRST =
  'First, before any agent: sweep. For every item, gather evidence from what is already in the context window and from the live stores, and dismiss straight off, with mcp__witness__confirm, every item that is already done; only what survives the sweep is sliced, and only it may get an agent.'

export function tacklePrompt(asks: readonly Ask[], skill: string | null = ESTATE_TACKLE_SKILL): string | null {
  const todo = undone(asks)
  if (todo.length === 0) return null
  const items = todo.map((a, i) => {
    const pale = a.state === 'claimed' ? ' (claimed done, never verified: verify it or finish it)' : ''
    return `${i + 1}. ${cleanText(a.text)}${pale}`
  })
  return [
    tackleHeader(skill),
    SWEEP_FIRST,
    ...items,
    'Done means witnessed: close each item with a read-back of what it changed (a test run, a fetch, a re-read). Leave anything only I can witness, such as a layout, for my look, and anything that needs my own hands (a login, a payment, a recording) for me: list it as mine, never give it to an agent.',
  ].join('\n')
}

const PASTED = /<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/g
const TACKLE_END = 'Done means witnessed'

/**
 * A prompt with what Bradley quoted cut out: a pasted block, and a /tackle prompt quoted
 * inside his own words (seen live, S166: pasting 405_85labs' /tackle to talk about it minted
 * five of 85labs' asks as his). A /tackle prompt sent whole is skipped before this.
 */
export function withoutQuoted(text: string): string {
  const unpasted = text.replace(PASTED, ' [pasted text] ')
  const title = unpasted.indexOf(TACKLE_TITLE)
  if (title === -1) return unpasted
  const skill = /\/\S+\s+$/.exec(unpasted.slice(0, title))
  const at = skill === null ? title : title - skill[0].length
  const end = unpasted.indexOf(TACKLE_END, at)
  const lineEnd = end === -1 ? -1 : unpasted.indexOf('\n', end)
  const tail = end === -1 || lineEnd === -1 ? '' : unpasted.slice(lineEnd)
  return `${unpasted.slice(0, at)} [a quoted /tackle prompt] ${tail}`
}

/**
 * The print, for a project that keeps no session log, on the /close prompt itself as a note
 * the close skill reads (a field report: 604_wasgenring's light protocol keeps none, so
 * Step 4b had nothing to triage).
 */
export function closePrintNote(print: string, estate = true): string {
  const settle = estate ? 'triage it in /close Step 4b' : 'settle it'
  return [
    `witness: this project keeps no session log, so the watch print could not be written into one. It follows here: ${settle} as if it stood in the log, and give the verdicts in the close summary.`,
    '',
    print.trim(),
  ].join('\n')
}

/** The first line of the prompt /wrap submits; its text is the companion's own print, never new asks. */
export const WRAP_READ_HEADER = 'witness /wrap: the watch is printed. Read it and settle what it lists.'

export function isWrapReadPrompt(text: string): boolean {
  return text.trim().startsWith(WRAP_READ_HEADER)
}

/**
 * What /wrap hands the main session (Bradley, 2026-10-08: "it would also be nice for the
 * main session to automatically read the printed work"): the print itself, and what to do
 * with each line. Submitted as a turn of its own; settling only, no new work.
 */
export function wrapReadPrompt(
  print: string,
  logPath: string | null,
  person: string = DEFAULT_PERSON,
  closeName = '/close',
): string {
  const who = personRef(person)
  const where =
    logPath === null
      ? 'It was not written to a session log (none is open for this session); the undone were kept for the next watch.'
      : `It is written into ${logPath}.`
  return [
    WRAP_READ_HEADER,
    where,
    `For every line not marked [x]: if it is done, read it back now and confirm it with ${CONFIRM_TOOL}; if ${who} called it off, drop it with ${CONFIRM_TOOL} and outcome "dropped", citing those words; otherwise leave it open and say in one line what it waits on. Builds stay for ${closeName} to make to-dos.`,
    'Start no new work. Then report in a few lines: what was confirmed, what was dropped, what stays open.',
    '',
    print.trim(),
  ].join('\n')
}

export function tally(asks: readonly Ask[], ledger: Ledger): string {
  const c = counts([...asks])
  const claims = ledger.claims.length
  const carried = c.carried > 0 ? `, ${c.carried} carried undone` : ''
  const builds = c.builds > 0 ? `, ${c.builds} build${c.builds === 1 ? '' : 's'} for the to-do list` : ''
  return `asks ${c.done}/${c.total} witnessed, ${c.pale} pale${carried}${builds}; claims ${claims - paleCount(ledger)}/${claims} witnessed`
}
