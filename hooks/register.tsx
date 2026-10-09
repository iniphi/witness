import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type {
  Activity,
  Ask,
  Barnacle,
  BoardRow,
  Body,
  Candidate,
  Costume,
  Friction,
  Heard,
  Hold,
  Ledger,
  LogBinding,
  NoticeQueue,
  Observed,
  Spoken,
  Ticket,
  UsagePass,
  UsageRow,
  Watch,
  WatchInfo,
} from '../types'
import {
  applyMatches,
  applyTriage,
  carryOver,
  counts,
  dropAsk,
  extractPrompt,
  matchPrompt,
  MAX_PREVIOUS_CHARS,
  mergeGoals,
  nm,
  paneRows,
  parseExtraction,
  parseGoals,
  parseTriage,
  parseMatch,
  printSection,
  resolveStates,
  seedCarried,
} from './asks'
import { isIdle, touch } from './bells'
import {
  ESTATE_TACKLE_SKILL,
  NO_ADAPTERS,
  TICKET_SCRIPT,
  WATCH_SCRIPT,
  personRef,
  readConfig,
  rootFromModuleUrl,
  scriptCandidates,
  writerPattern,
} from './config'
import type { Adapters, Config } from './config'
import {
  afterScrub,
  asScrubbed,
  frictionFrom,
  markSpoken,
  mergeBarnacles,
  nextToSpeak,
  noteFriction,
  parseRecur,
  realFriction,
  recurPrompt,
  regrown,
  scrub,
  stampScrub,
  unscrub,
} from './barnacles'
import type { RecentCall } from './barnacles'
import { parseCostume } from './sprites'
import {
  CONFIRM_TOOL,
  confirmDescription,
  confirmSchema,
  confirmAsks,
  confirmReport,
  hear,
  inputText,
  observe,
  parseItems,
  unprovedNote,
} from './evidence'
import {
  CANDIDATE_MIN_NEW_CALLS,
  HEADS_UP,
  INSTALLED_GUARDS,
  appendCandidates,
  callDigest,
  candidatesPath,
  candidatesPrompt,
  candidatesSection,
  markFiled,
  mergeCandidates,
  notesSection,
  noteHeard,
  noteSpoken,
  parseCandidates,
  shouldScan,
} from './notes'
import { bandTree, barnaclesTree, beneathText, paneTree } from './render'
import { needsHold, withReturning } from './sql'
import {
  HELPER_TIMEOUT_MS,
  SIDE_PASS,
  askText,
  bindLog,
  claimable,
  freshAsks,
  isCloseCommand,
  isOpenLog,
  isTacklePrompt,
  isWrapReadPrompt,
  logTouch,
  needsOpenCheck,
  newIds,
  projectKey,
  storeKeys,
  tacklePrompt,
  tally,
  undone,
  closePrintNote,
  withPrint,
  withoutQuoted,
  wrapReadPrompt,
} from './support'
import type { LogTouch } from './support'
import { TICKET_MS, UNAVAILABLE_TICKET, ticketFromRun } from './ticket'
import { addUsage, turnRow, usageDir, usageFile, usagePath, usageRow } from './usage'
import { EYE_ROW, HOLD_TEXT, buildView } from './view'
import { dismiss, dismissable, enqueue, remove, settle, showing } from './notices'
import { landedRows, parseRows, parseWatch, watchHeader, watchText } from './watch'
import { claimLabel, classify, developByAsks, recordAgentTurn, recordCall, recordTurn } from './witness'

const PANE = 'witness-undone'
const BARNACLES_PANE = 'witness-barnacles'
const SQL_TOOL = 'mcp__claude_ai_Supabase__execute_sql'
const FRAME_MS = 1_500
const FRAME_CYCLE = [0, 0, 0, 1, 0, 0, 2, 0]
const HOUSEKEEP_MS = 15_000
const POLL_MS = 5 * 60_000
const SPEAK_MS = 90_000
const PRINT_MS = 5 * 60_000
const RECENT_CAP = 20
const ADD = 'Add RETURNING'
const ONCE = 'Let through once'
const CANCEL = 'Cancel'
const TAKE = 'Take the watch'
const HOLD_FAILED =
  'witness: the hold failed, so the write was NOT sent. Re-send it naming what it touches: WITH w AS (<statement> RETURNING *) SELECT * FROM w.'
const SUBAGENT_HELD =
  'witness: a subagent may not send an UPDATE or DELETE that names nothing it touched (no one is there to answer the hold). Re-send it as WITH w AS (<statement> RETURNING *) SELECT * FROM w.'
// 1.1 (ruled 2026-10-09): a subagent's report is a claim the main session reads back.
const SUBAGENT_CONFIRM =
  "witness: a subagent may not confirm asks. Its report is a claim the main session must read back; say what you changed, and the main session confirms on its own read-back."

// Every value the band and the pane draw from, held by the host for the session
// (they survive a hot reload; module variables do not). Declared here, not
// imported: the engine reads a state reference only where its literals are written.
const EMPTY_LEDGER: Ledger = { writes: [], claims: [], turns: {} }
const EMPTY_ACTIVITY: Activity = { activeMs: 0, lastAt: null }
const PENDING_WATCH: Watch = { state: 'pending', info: null, takenAt: null }

const ledgerAtom = atom({ plugin: 'witness', key: 'ledger' } as const, EMPTY_LEDGER)
const asksAtom = atom({ plugin: 'witness', key: 'asks' } as const, [] as Ask[])
const activityAtom = atom({ plugin: 'witness', key: 'activity' } as const, EMPTY_ACTIVITY)
const noticesAtom = atom({ plugin: 'witness', key: 'notices' } as const, { items: [], seen: 0 } as NoticeQueue)
const holdAtom = atom({ plugin: 'witness', key: 'hold' } as const, null as Hold | null)
const watchAtom = atom({ plugin: 'witness', key: 'watch' } as const, PENDING_WATCH)
const barnaclesAtom = atom({ plugin: 'witness', key: 'barnacles' } as const, [] as Barnacle[])
const frameAtom = atom({ plugin: 'witness', key: 'frame' } as const, 0)
const costumeAtom = atom({ plugin: 'witness', key: 'costume' } as const, 'none' as Costume)
// The running turn survives a mid-turn hot reload, so its later writes stay in its claim.
const turnAtom = atom({ plugin: 'witness', key: 'turn' } as const, 'turn-0')
// What the confirm tool checks evidence against: calls the mod saw, and Bradley's own words.
const observedAtom = atom({ plugin: 'witness', key: 'observed' } as const, [] as Observed[])
const heardAtom = atom({ plugin: 'witness', key: 'heard' } as const, [] as Heard[])
// For the print (S163): what the companion said, and the hook and skill candidates.
const spokenAtom = atom({ plugin: 'witness', key: 'spoken' } as const, [] as Spoken[])
const candidatesAtom = atom({ plugin: 'witness', key: 'candidates' } as const, [] as Candidate[])
const candidateScanAtom = atom({ plugin: 'witness', key: 'candidateScanAt' } as const, 0)
// The estate ticket the one line opens with (0.3.0, folded in from estate-status).
const ticketAtom = atom({ plugin: 'witness', key: 'ticket' } as const, null as Ticket | null)
// What each Haiku side pass cost (0.4.0), written to this session's usage file.
const usageAtom = atom({ plugin: 'witness', key: 'usage' } as const, [] as UsageRow[])
// The session log this watch follows (1.1): bound by the main loop's own file calls, kept across a hot reload.
const logAtom = atom({ plugin: 'witness', key: 'log' } as const, null as LogBinding | null)

// The session's plain values. The engine follows `$` only into functions declared at
// the top of this file, so the helpers read this record rather than closures. It is
// replaced, never mutated, and lost on a hot reload (register runs again), which
// nothing here needs to survive: what must survive is in $.state and $.store.
type Session = {
  body: Body
  watchHold: boolean
  cwd: string
  key: string
  interactive: boolean
  /** Epoch ms the session started: an older session log is not this session's. */
  startedAt: number
  tick: number
  recent: RecentCall[]
  friction: Friction[]
  rowIds: string[]
  /** A candidate pass is in flight; the housekeeping tick must not start a second. */
  scanning: boolean
  /** The session's id (its transcript's name): names this session's usage file. */
  sessionId: string
  /** A /tackle prompt went in: the main turn it starts is recorded as `tackle`. */
  tackleTurn: boolean
  /** Asks a turn called done without proof, to put to Claude on the next prompt. */
  nudge: string[]
  /** Asks already put to Claude this session: each is put once. */
  nudged: string[]
  /** The end of the last main answer: an approval on the next prompt is read against it. */
  lastAnswer: string
  /** Notes from beneath already recorded since this load, so a redraw does not record one again. */
  headsUp: string[]
  /** The userConfig fields, read once per load (1.0: the core/estate split). */
  config: Config
  /** The configured writer calls as a pattern; null: none. */
  writers: RegExp | null
  /** The estate adapters found at session start; null is off. */
  adapters: Adapters
  /** Where usage files go; null (none written) when the home is unknown. */
  usageDir: string | null
}

let s: Session = {
  body: 'phi',
  watchHold: false,
  cwd: '',
  key: '',
  interactive: false,
  startedAt: 0,
  tick: 0,
  recent: [],
  friction: [],
  rowIds: [],
  scanning: false,
  sessionId: '',
  tackleTurn: false,
  nudge: [],
  nudged: [],
  lastAnswer: '',
  headsUp: [],
  config: readConfig({}),
  writers: writerPattern(readConfig({}).writers),
  adapters: NO_ADAPTERS,
  usageDir: null,
}

function setSession(patch: Partial<Session>): void {
  s = { ...s, ...patch }
}

function isHeldSql(e: any): boolean {
  return e?.tool === SQL_TOOL && typeof e.query === 'string' && needsHold(e.query)
}

// ---- reaching out: helper script, session log, side passes, store ----

async function say($: any, header: string, text: string, full: boolean, until: number | null): Promise<void> {
  const at = await $.clock.now()
  const id = newIds(at, 1, 'n')[0] ?? `n${at}`
  await update($, noticesAtom, q => enqueue(q, { kind: 'own', header, text, full, until }, id, at))
  await update($, spokenAtom, log => noteSpoken(log, { header, text, at }))
}

/** A note from beneath (Claude Code's own "Heads up"), into Notes taken once (to-do 3f23...c538). */
async function hearBeneath($: any, text: string): Promise<void> {
  const at = await $.clock.now()
  await update($, spokenAtom, log => noteHeard(log, { header: HEADS_UP, text, at }))
}

/** The estate is present when its ticket script is: /tackle names /agile, the guard list is the estate's. */
function estate(): boolean {
  return s.adapters.ticket !== null
}

async function firstExisting($: any, paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      if ((await $.fs.exists(path)) === true) return path
    } catch {}
  }
  return null
}

/**
 * The mod's own folder: the engine's word (`$.plugin.root`), else this module's own
 * location, which cannot be blank. Added after the estate line vanished for a morning
 * (2026-10-09): the engine answered the lookup with nothing, the adapter read that as
 * "no estate", and the band fell silent with no sign that it had not looked.
 */
function pluginRoot($: any): string {
  let given: unknown = ''
  try {
    given = $.plugin.root
  } catch {
    given = ''
  }
  if (typeof given === 'string' && given !== '') return given
  try {
    return rootFromModuleUrl(import.meta.url)
  } catch {
    return ''
  }
}

/** The adapters' scripts: configured, else found in the mod's own repository; absent, off. */
async function findAdapters($: any, cwd: string, root: string): Promise<Adapters> {
  return {
    ticket: await firstExisting($, scriptCandidates(s.config.ticketScript, root, cwd, TICKET_SCRIPT)),
    watch: await firstExisting($, scriptCandidates(s.config.watchScript, root, cwd, WATCH_SCRIPT)),
  }
}

async function homeDir($: any): Promise<string | undefined> {
  const profile = await $.env.get('USERPROFILE').catch(() => undefined)
  return profile ?? (await $.env.get('HOME').catch(() => undefined))
}

async function runHelper($: any, extra: string[]): Promise<{ exitCode: number; stdout: string } | null> {
  if (s.adapters.watch === null) return null
  try {
    return await $.process.run(['python', s.adapters.watch, '--json', ...extra, '--project-dir', s.cwd], {
      timeoutMs: HELPER_TIMEOUT_MS,
    })
  } catch {
    return null
  }
}

/**
 * Every Haiku side pass goes through here, so each one's cost is recorded as the API
 * reported it (0.4.0, S165). Recording never fails the pass it measures.
 */
async function complete($: any, pass: UsagePass, prompt: string): Promise<any> {
  const r = await $.model.complete({ ...SIDE_PASS, prompt })
  await recordUsage($, pass, r).catch(() => undefined)
  return r
}

async function recordUsage($: any, pass: UsagePass, r: any): Promise<void> {
  await appendUsage($, usageRow(pass, await $.clock.now(), r))
}

/** Adds one row (a side pass or a turn) and rewrites this session's usage file. */
async function appendUsage($: any, row: UsageRow): Promise<void> {
  await update($, usageAtom, rows => addUsage(rows, row))
  const sessionId = s.sessionId === '' ? `session-${s.startedAt}` : s.sessionId
  const file = usageFile({
    sessionId,
    repo: s.key,
    startedAt: s.startedAt,
    model: SIDE_PASS.model,
    rows: await read($, usageAtom),
  })
  if (s.usageDir !== null) await $.fs.write(usagePath(s.usageDir, s.startedAt, sessionId), file)
}

/**
 * The note for Claude, once per ask (Bradley, S165, option B): asks a turn called done
 * without proof that are still unproved now. Null when there is nothing to put.
 */
async function takeNudge($: any): Promise<string | null> {
  if (s.nudge.length === 0) return null
  const pending = s.nudge
  setSession({ nudge: [], nudged: [...s.nudged, ...pending] })
  const asks = await read($, asksAtom)
  const still = asks.filter(a => pending.includes(a.id) && a.state === 'claimed')
  return still.length === 0 ? null : unprovedNote(still.map(a => ({ id: a.id, text: a.text })))
}

/** Re-reads the estate ticket; a helper that cannot run leaves it unavailable, never zeros. */
async function refreshTicket($: any): Promise<void> {
  if (s.adapters.ticket === null) return
  let run: { exitCode: number; stdout: string } | null
  try {
    run = await $.process.run(['python', s.adapters.ticket, '--json', '--project-dir', s.cwd], {
      timeoutMs: HELPER_TIMEOUT_MS,
    })
  } catch {
    run = null
  }
  const ticket = ticketFromRun(run)
  await update($, ticketAtom, () => ticket)
}

/**
 * The session log this watch is bound to (1.1), read by its one path: no folder listing
 * and no mtime test, so another session's log in the same repo is never followed.
 * Unbound (a session that has not touched its log yet): null.
 */
async function boundLog($: any): Promise<{ path: string; text: string } | null> {
  const bound: LogBinding | null = await read($, logAtom)
  if (bound === null) return null
  try {
    if (!(await $.fs.exists(bound.path))) return null
    const text: string = await $.fs.read(bound.path)
    return { path: bound.path, text }
  } catch {
    return null
  }
}

/** The bound log while it is open: its Goals are synced and the print is written into it. */
async function openLog($: any): Promise<{ path: string; text: string } | null> {
  const log = await boundLog($)
  return log !== null && isOpenLog(log.text) ? log : null
}

/** The bound log, closed or not: the close triage lands after the close. */
async function sessionLog($: any): Promise<{ path: string; text: string } | null> {
  return boundLog($)
}

/**
 * Binds the watch to the session log a main-loop file call touched (1.1). A Write of another
 * log over a Write rebinds only once the bound log is closed, so that log is read first.
 */
async function bindTouch($: any, touch: LogTouch, now: number): Promise<void> {
  const current: LogBinding | null = await read($, logAtom)
  const open = needsOpenCheck(current, touch) ? (await openLog($)) !== null : true
  const next = bindLog(current, touch, now, open)
  if (next === current) return
  await update($, logAtom, () => next)
  // The goals' source moved: read its Goals now rather than at the next tick.
  if (s.interactive && (current === null || current.path !== next?.path)) $.clock.after(0, () => syncGoals($, now))
}

/** What the close triage settled leaves the undone (0.8.0, a field report). */
async function syncTriage($: any): Promise<void> {
  const log = await sessionLog($)
  if (log === null) return
  const triage = parseTriage(log.text)
  if (triage.dismissed.length + triage.todo.length === 0) return
  await update($, asksAtom, asks => applyTriage(asks, triage))
}

/**
 * Reads the open log's Goals into the asks ledger. Runs at session start, at every turn's
 * end, AND on the housekeeping tick and every prompt: one long turn (S163, an hour of work
 * with Bradley's messages arriving mid-turn) never reached a turn's end, so the log's goals
 * never arrived and the band read 0/7 while the work landed.
 *
 * A goal is dated from the session's start, not from when it was synced: synced late,
 * it would have refused every read-back made before the sync as evidence.
 */
async function syncGoals($: any, now: number): Promise<void> {
  await syncTriage($).catch(() => undefined)
  const log = await openLog($)
  const goals = log === null ? [] : parseGoals(log.text, s.config.goalsHeading)
  if (goals.length === 0) return
  const ids = newIds(now, goals.length, 'g')
  const at = s.startedAt > 0 ? s.startedAt : now
  const ledger = await read($, ledgerAtom)
  await update($, asksAtom, asks => resolveStates(mergeGoals(asks, goals, { at, ids }), ledger))
}

/** The Haiku pass over one of Bradley's prompts. Adds nothing to Claude's context. */
async function extractAsks($: any, text: string, now: number, previous: string): Promise<void> {
  const before: Ask[] = await read($, asksAtom)
  const r = await complete($, 'extract', extractPrompt(text, before, previous))
  if (!r.isAnswered) return
  const found = parseExtraction(r.text, before)
  if (found.asks.length + found.builds.length === 0) return
  // A multi-session build is held apart from this session's asks (0.6.0).
  const fresh = [
    ...freshAsks(found.asks, newIds(now, found.asks.length, 'a'), now),
    ...freshAsks(found.builds, newIds(now, found.builds.length, 'b'), now, 'build'),
  ]
  await update($, asksAtom, list => [...list, ...fresh])
}

/** Which open asks a "done" answer claims; they ride on that claim from here. */
async function matchAsks($: any, claimId: string, answer: string): Promise<void> {
  const open = claimable(await read($, asksAtom))
  if (open.length === 0) return
  const r = await complete($, 'match', matchPrompt(open, answer))
  if (!r.isAnswered) return
  const ids = parseMatch(r.text, open.length).flatMap(n => open[n - 1]?.id ?? [])
  if (ids.length === 0) return
  const ledger = await read($, ledgerAtom)
  await update($, asksAtom, list => resolveStates(applyMatches(list, ids, claimId), ledger))
  await developFromAsks($)
}

/** A claim whose matched asks are all witnessed develops (to-do 3f33...1b36); its asks follow it. */
async function developFromAsks($: any): Promise<void> {
  const asks: Ask[] = await read($, asksAtom)
  await update($, ledgerAtom, l => developByAsks(l, asks))
  const ledger = await read($, ledgerAtom)
  await update($, asksAtom, a => resolveStates(a, ledger))
}

async function saveCarry($: any): Promise<void> {
  await $.store.set(storeKeys(s.key).carry, carryOver(await read($, asksAtom)))
}

async function saveFriction($: any): Promise<void> {
  await $.store.set(storeKeys(s.key).friction, s.friction)
}

async function loadStored($: any, now: number): Promise<void> {
  const keys = storeKeys(s.key)
  const carried = await $.store.get(keys.carry)
  if (Array.isArray(carried) && carried.length > 0) {
    const seeded = seedCarried(carried as Ask[], { at: now, ids: newIds(now, carried.length, 'k') })
    await update($, asksAtom, a => (a.length === 0 ? seeded : a))
  }
  const log = await $.store.get(keys.friction)
  // Legacy third-edit entries are dropped: a file under build is work, not friction (1.1).
  setSession({ friction: realFriction(Array.isArray(log) ? (log as Friction[]) : []) })
  const stored = await $.store.get(keys.candidates)
  if (Array.isArray(stored)) await update($, candidatesAtom, () => stored as Candidate[])
}

/**
 * The hook and skill candidate pass (S163). A Haiku side pass over this session's call
 * digest and the project's friction; adds nothing to Claude's context. `force` (the print)
 * skips the interval but still needs enough new calls to be worth reading.
 */
async function scanCandidates($: any, now: number, force: boolean): Promise<void> {
  if (s.scanning || !s.interactive) return
  const lastScanAt: number = await read($, candidateScanAtom)
  const observed: Observed[] = await read($, observedAtom)
  const newCalls = observed.filter(o => o.at > lastScanAt && !o.agent).length
  const due = force ? newCalls >= CANDIDATE_MIN_NEW_CALLS : shouldScan({ now, lastScanAt, newCalls })
  if (!due) return
  setSession({ scanning: true })
  try {
    await update($, candidateScanAtom, () => now)
    const existing: Candidate[] = await read($, candidatesAtom)
    // The installed commands and skills, so a candidate never re-proposes one (a field report).
    const commands: any[] = await $.command.list().catch(() => [])
    const installed = commands
      .filter(c => c?.source === 'user' || c?.source === 'plugin')
      .map(c => ({ name: String(c.name), description: String(c.description ?? '') }))
    const guards = estate() ? INSTALLED_GUARDS : []
    const prompt = candidatesPrompt({ friction: s.friction, calls: callDigest(observed), existing, installed, guards })
    const r = await complete($, 'candidates', prompt)
    if (!r.isAnswered) return
    const fresh = parseCandidates(r.text, existing, now, guards)
    if (fresh.length === 0) return
    const next = mergeCandidates(existing, fresh)
    await update($, candidatesAtom, () => next)
    await $.store.set(storeKeys(s.key).candidates, next)
  } finally {
    setSession({ scanning: false })
  }
}

/** Appends this watch's unfiled candidates to the running file, then marks them filed. */
async function fileCandidates($: any, now: number, source: string): Promise<void> {
  const candidates: Candidate[] = await read($, candidatesAtom)
  const unfiled = candidates.filter(c => !c.filed)
  if (unfiled.length === 0) return
  const root = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = candidatesPath(s.cwd, await $.fs.exists(`${root}/reports`))
  const before: string = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const date = new Date(now).toISOString().slice(0, 10)
  await $.fs.write(path, appendCandidates(before, candidates, { date, source }))
  const next = markFiled(candidates, unfiled.map(c => c.key))
  await update($, candidatesAtom, () => next)
  await $.store.set(storeKeys(s.key).candidates, next)
}

/** Between sessions: keep the friction that recurs, as barnacles. */
async function recurBarnacles($: any): Promise<void> {
  const keys = storeKeys(s.key)
  const stored = await $.store.get(keys.barnacles)
  const stored_: Barnacle[] = Array.isArray(stored) ? (stored as Barnacle[]) : []
  // A scrubbed key's older friction is forgotten (/barnacles, 1.1): it grows back only from new friction.
  const log = afterScrub(s.friction, asScrubbed(await $.store.get(keys.scrubbed)))
  // A barnacle with no real friction behind it any more comes off (1.1, Bradley 2026-10-09:
  // the third-edit barnacles were never friction), whether or not the pass runs.
  const existing = stored_.filter(b => log.some(f => f.key === b.key))
  let next = existing
  if (log.length > 0) {
    const r = await complete($, 'barnacles', recurPrompt(log, existing))
    if (r.isAnswered) next = mergeBarnacles(existing, parseRecur(r.text))
  }
  await $.store.set(keys.barnacles, next)
  await update($, barnaclesAtom, () => next)
}

/**
 * Scrubs one barnacle (or every one, `key` null) off the shell: the list and the store lose
 * it, and the key is stamped scrubbed so the next recurrence pass reads only friction logged
 * after now (/barnacles, 1.1, Bradley 2026-10-09).
 */
async function scrubBarnacles($: any, key: string | null): Promise<void> {
  const now = await $.clock.now()
  const keys = storeKeys(s.key)
  const list: Barnacle[] = await read($, barnaclesAtom)
  const gone = key === null ? list : list.filter(b => b.key === key)
  const next = scrub(list, key)
  await update($, barnaclesAtom, () => next)
  await $.store.set(keys.barnacles, next)
  await $.store.set(keys.scrubbed, stampScrub(asScrubbed(await $.store.get(keys.scrubbed)), gone, now))
}

/**
 * A scrubbed barnacle regrows the moment its friction is recorded again (Bradley, 2026-10-09:
 * the scrub "hasn't worked properly" if it comes back, so say so): back on the shell with its
 * old words, unspoken, its scrub lifted so the recurrence pass sees the whole history again.
 */
async function regrowBarnacles($: any, found: readonly Friction[]): Promise<void> {
  if (found.length === 0) return
  const keys = storeKeys(s.key)
  const scrubbed = asScrubbed(await $.store.get(keys.scrubbed))
  const shell: Barnacle[] = await read($, barnaclesAtom)
  const back = found
    .map(f => regrown(scrubbed, f))
    .filter((b): b is Barnacle => b !== null && !shell.some(x => x.key === b.key))
    .filter((b, i, all) => all.findIndex(x => x.key === b.key) === i)
  if (back.length === 0) return
  const next = [...shell, ...back]
  await update($, barnaclesAtom, () => next)
  await $.store.set(keys.barnacles, next)
  await $.store.set(keys.scrubbed, back.reduce((acc, b) => unscrub(acc, b.key), scrubbed))
}

/** End of watch: the print into the open session log, the undone carried forward. */
/** What a print came to: the line said to Bradley, the print itself, and where it was written. */
type Printed = { summary: string; print: string; path: string | null }

async function writePrint($: any): Promise<Printed> {
  const now = await $.clock.now()
  const asks: Ask[] = await read($, asksAtom)
  const ledger = await read($, ledgerAtom)
  await saveCarry($)
  const counted = tally(asks, ledger)
  const log = await openLog($)
  if (log === null) {
    const summary = `No open session log from this session; the undone were kept for the next watch (${counted}).`
    return { summary, print: printSection(asks, ledger), path: null }
  }
  await scanCandidates($, now, true).catch(() => undefined)
  const spoken: Spoken[] = await read($, spokenAtom)
  const candidates: Candidate[] = await read($, candidatesAtom)
  const extra = [
    ...notesSection({ friction: s.friction, spoken, since: s.startedAt }),
    '',
    ...candidatesSection(candidates, s.startedAt),
  ]
  const print = printSection(asks, ledger, extra)
  await $.fs.write(log.path, withPrint(log.text, print))
  const name = log.path.split('/').pop() ?? log.path
  const filed = await fileCandidates($, now, name).then(() => '', () => ' The candidates file could not be written.')
  const summary = `Witness print written to ${log.path} (${counted}). Pale and open asks are listed there as open, never as done.${filed}`
  return { summary, print, path: log.path }
}

/**
 * /tackle: the undone asks as an /agile run, put in the prompt box for Bradley to
 * read and send. Never over a draft he is writing, and never sent by the mod.
 */
async function tackle($: any): Promise<string> {
  // A /tackle right after /close must see the triage the close just wrote.
  await syncTriage($).catch(() => undefined)
  const asks: Ask[] = await read($, asksAtom)
  const skill = estate() ? ESTATE_TACKLE_SKILL : null
  const text = tacklePrompt(asks, skill)
  if (text === null) return 'Nothing undone: every ask this watch is witnessed or dropped.'
  const box: any = await $.prompt.read()
  if (typeof box?.text === 'string' && box.text.trim().length > 0) {
    return 'Your prompt box holds a draft; clear it, then /tackle again.'
  }
  const filled: any = await $.prompt.fill({ text, mode: 'replace' })
  const n = undone(asks).length
  return filled?.isFilled === false
    ? `The prompt box would not take the ${skill ?? 'tackle'} run.`
    : `${skill ?? 'A run'} over ${n} undone ask${n === 1 ? '' : 's'} is in your prompt box: read it, then press Enter.`
}

/**
 * The confirm tool: Claude says asks are done, and only the evidence the mod checks
 * against its own observations counts. Answered here; it never reaches a tool.
 */
async function confirm($: any, input: unknown): Promise<string> {
  const items = parseItems(input)
  if (items.length === 0) return 'Nothing to confirm: pass items of { ask, evidence: [...] }.'
  const now = await $.clock.now()
  const observed = await read($, observedAtom)
  const heard = await read($, heardAtom)
  const before: Ask[] = await read($, asksAtom)
  const { asks, verdicts } = confirmAsks(before, items, observed, heard, now, s.config.person)
  await update($, asksAtom, () => asks)
  await developFromAsks($)
  await saveCarry($)
  const won = verdicts.filter(v => v.ok && v.reason === 'witnessed').length
  if (won > 0) await say($, 'WITNESSED', `${won} ask${won === 1 ? '' : 's'} done: a read-back proved it.`, false, now + 30_000)
  return confirmReport(verdicts, asks, s.config.closeCommands[0])
}

// ---- the watch ----

function taken(w: Watch, now: number): Watch {
  return { ...w, state: 'taken', takenAt: now }
}

async function relieve($: any): Promise<void> {
  const run = await runHelper($, [])
  const info: WatchInfo | null = run === null ? null : parseWatch(run)
  setSession({ rowIds: info?.inbox?.map(r => r.id) ?? [] })
  await update($, watchAtom, w => ({ ...w, info }))
  const w = await read($, watchAtom)
  if (w.state !== 'pending') return
  // No watch script (1.0): nothing to measure or say; taken quietly so a barnacle may speak.
  if (s.adapters.watch === null && !s.watchHold) {
    const at = await $.clock.now()
    await update($, watchAtom, x => taken(x, at))
    return
  }
  // With the hold on, an unmeasured watch waits for the first prompt, which asks and
  // says so (takeWatch). With it off, nothing would ever take it, and a pending watch
  // never lets a barnacle speak (S165): so it is said and taken here, measured or not.
  if (info === null && s.watchHold) return
  const now = await $.clock.now()
  const header = info ? watchHeader(info) : 'WATCH'
  const text = info ? watchText(info) : 'Watch not measured.'
  await say($, header, text, true, s.watchHold ? null : now + SPEAK_MS)
  if (!s.watchHold) await update($, watchAtom, x => taken(x, now))
}

async function takeWatch($: any, now: number): Promise<void> {
  const w = await read($, watchAtom)
  if (w.state !== 'pending' && !isIdle(await read($, activityAtom), now)) return
  const info = w.info
  await say($, info ? watchHeader(info) : 'WATCH', info ? watchText(info) : 'Watch not measured.', true, null)
  let answer = ''
  try {
    answer = await $.ui.ask('Take the watch?', { header: 'Watch', options: [TAKE, 'Not now'] })
  } catch {
    answer = 'dismissed'
  }
  await update($, watchAtom, x => taken(x, now))
  await say($, 'WATCH', answer === TAKE ? 'Watch taken.' : 'Watch left untaken.', false, now + 20_000)
}

async function poll($: any): Promise<void> {
  const run = await runHelper($, ['--rows'])
  const rows: BoardRow[] | null = run === null ? null : parseRows(run)
  if (rows === null) return
  const w = await read($, watchAtom)
  const info = w.info ? { ...w.info, inbox: rows } : null
  const landed = info ? landedRows(s.rowIds, info) : []
  setSession({ rowIds: rows.map(r => r.id) })
  if (info) await update($, watchAtom, x => ({ ...x, info }))
  const first = landed[0]
  if (first === undefined) return
  const now = await $.clock.now()
  // The sender, said as one: "501_blog: ..." in an Overseer session read as 501_blog's
  // own board leaking in (S165), when it is a row 501_blog sent to this board.
  $.ui.toast(`Board: ${landed.length} new, from ${first.from}: ${first.subject}`)
  await say($, 'BOARD', `from ${first.from}: ${first.subject}`, false, now + 120_000)
}

async function housekeep($: any): Promise<void> {
  const now = await $.clock.now()
  await syncGoals($, now).catch(() => undefined)
  $.clock.after(0, () => scanCandidates($, now, false).catch(() => undefined))
  await update($, noticesAtom, q => settle(q, now))
  const w = await read($, watchAtom)
  // One barnacle at a time: it waits until the queue has emptied.
  if (w.state !== 'taken' || (await read($, noticesAtom)).items.length > 0) return
  const barnacles = await read($, barnaclesAtom)
  const next = nextToSpeak(barnacles)
  if (next === null) return
  await say($, 'YOU SHOULD KNOW', next.text, true, now + SPEAK_MS)
  const marked = markSpoken(barnacles, next.key)
  await update($, barnaclesAtom, () => marked)
  await $.store.set(storeKeys(s.key).barnacles, marked)
}

/** One idle-animation step; writes (and so redraws) only when the frame changes. */
async function stepFrame($: any): Promise<void> {
  setSession({ tick: s.tick + 1 })
  const next = FRAME_CYCLE[s.tick % FRAME_CYCLE.length] ?? 0
  if ((await read($, frameAtom)) !== next) await update($, frameAtom, () => next)
}

// ---- the witness: the hold and the ledger ----

async function holdWrite($: any, e: any): Promise<{ pass: boolean; e: any; reason: string }> {
  const now = await $.clock.now()
  const fixed = withReturning(e.query)
  await update($, holdAtom, () => ({ toolUseId: e.tool_use_id, sql: e.query, fixed, at: now }))
  // First in the queue until answered; never dismissed.
  const heldId = `h${now}`
  const held = { kind: 'held' as const, header: 'HELD', text: HOLD_TEXT, full: true, until: null }
  await update($, noticesAtom, q => enqueue(q, held, heldId, now))
  let answer = CANCEL
  try {
    const question =
      fixed === null
        ? 'This write names nothing it touched, and no safe RETURNING form exists. What should happen to it?'
        : `This write names nothing it touched. Add RETURNING would send: ${fixed} - what should happen to it?`
    answer = await $.ui.ask(question, { header: 'Held', options: fixed === null ? [ONCE, CANCEL] : [ADD, ONCE, CANCEL] })
  } catch {
    answer = CANCEL
  } finally {
    await update($, holdAtom, () => null)
    await update($, noticesAtom, q => remove(q, heldId))
  }
  // Every answer but a cancel is noted here; a cancel is noted by the deny's classification.
  const noted = (kind: Friction['kind']): void => {
    const f: Friction = { kind, key: SQL_TOOL, at: now, detail: askText(e.query).slice(0, 160) }
    setSession({ friction: noteFriction(s.friction, f) })
  }
  if (answer === ADD && fixed !== null) {
    noted('returning-added')
    return { pass: true, e: { ...e, query: fixed }, reason: '' }
  }
  if (answer === ONCE) {
    noted('let-through')
    return { pass: true, e, reason: '' }
  }
  const who = personRef(s.config.person)
  const said = answer === CANCEL ? '' : ` ${who.charAt(0).toUpperCase()}${who.slice(1)} said: ${answer}`
  return {
    pass: false,
    e,
    reason: `witness: held and cancelled - an UPDATE or DELETE must name what it touched; use WITH w AS (<statement> RETURNING *) SELECT * FROM w.${said}`,
  }
}

async function recordRun($: any, e: any, ran: any): Promise<void> {
  const now = await $.clock.now()
  const { tool, tool_use_id: _id, agentId, ...input } = e
  const resultText = ran.deny !== undefined ? String(ran.deny) : String(ran.text ?? '')
  const isError = ran.deny !== undefined || ran.isError === true
  const classified = classify({ tool, input, resultText, isError, isReadOnly: ran.isReadOnly === true, writers: s.writers })
  const ids = newIds(now, classified.writes.length, 'w')
  const turnId = await read($, turnAtom)
  const subagent = agentId !== undefined
  // An agent's writes ride the main turn's id, attributed to the agent so its report can claim them (1.1).
  const by = subagent ? { agentId: String(agentId) } : {}
  await update($, ledgerAtom, l => recordCall(l, { turnId, at: now, ids, classified, subagent, ...by }))
  const ledger = await read($, ledgerAtom)
  await update($, asksAtom, a => resolveStates(a, ledger))
  const seen: Observed = {
    toolUseId: String(_id ?? ''),
    tool,
    input: inputText(input),
    result: resultText,
    isError,
    agent: subagent,
    at: now,
  }
  await update($, observedAtom, log => observe(log, seen))
  // Friction is the main session's own: a sub-agent's failures, interleaved across agents,
  // are neither its friction nor part of its "in a row" (a field report).
  if (!subagent) {
    const found = frictionFrom({ tool, input, resultText, isError, recent: s.recent, at: now })
    setSession({
      friction: found.reduce(noteFriction, s.friction),
      recent: [...s.recent, { tool, input, isError, at: now }].slice(-RECENT_CAP),
    })
    await regrowBarnacles($, found)
  }
  await update($, activityAtom, a => touch(a, now))
  // The watch follows the log the main loop itself writes, edits or reads (1.1); an agent's binds nothing.
  if (!subagent && !isError) {
    const logged = logTouch(tool, input, s.cwd, s.config.sessionsDir)
    if (logged !== null) await bindTouch($, logged, now)
  }
}

/** Asks called done on this claim and still unproved: put to Claude on the next prompt, once each. */
function noteUnproved(asks: readonly Ask[], claimId: string): void {
  const unproved = asks
    .filter(a => a.state === 'claimed' && a.claimId === claimId && !s.nudged.includes(a.id))
    .map(a => a.id)
  if (unproved.length > 0) setSession({ nudge: [...new Set([...s.nudge, ...unproved])] })
}

async function afterTurn($: any, now: number, claimId: string | null, answer: string): Promise<void> {
  await syncGoals($, now)
  if (claimId !== null) {
    await matchAsks($, claimId, answer)
    noteUnproved(await read($, asksAtom), claimId)
  }
  await saveCarry($)
  await saveFriction($)
}

/**
 * A subagent's final report (1.1, ruled 2026-10-09): a pale claim the main session must read
 * back before it develops. Minted only for an agent this mod saw make a call; its asks are
 * matched, and an unproved one put to Claude, exactly as for any claim.
 */
async function agentReport($: any, agentId: string, answer: string, now: number): Promise<void> {
  const cid = newIds(now, 1, 'c')[0] ?? `c${now}`
  let minted: string | null = null
  await update($, ledgerAtom, l => {
    const r = recordAgentTurn(l, { agentId, at: now, answer, id: cid })
    minted = r.claim?.id ?? null
    return r.ledger
  })
  const claimId: string | null = minted
  if (claimId === null) return
  const ledger = await read($, ledgerAtom)
  await update($, asksAtom, a => resolveStates(a, ledger))
  $.clock.after(0, () => afterAgentReport($, claimId, answer))
}

async function afterAgentReport($: any, claimId: string, answer: string): Promise<void> {
  await matchAsks($, claimId, answer)
  noteUnproved(await read($, asksAtom), claimId)
  await saveCarry($)
}

/** A slash command's arguments can carry an ask (`/task fix the walker`); the command name cannot. */
function askableText(text: string): string {
  const t = text.trim()
  if (isTacklePrompt(t) || isWrapReadPrompt(t)) return ''
  // What he quoted or pasted is not what he asked (seen live, S166).
  if (!t.startsWith('/')) return withoutQuoted(t).trim()
  const rest = withoutQuoted(t.replace(/^\/\S+\s*/, '')).trim()
  return rest.length >= 12 ? rest : ''
}

// ---- events ----

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as { body?: string; watchHold?: boolean }
  const config = readConfig(options)
  setSession({ config, writers: writerPattern(config.writers) })
  // Off unless turned on (S164, ruled with the user-scope install): no project is held at every start.
  setSession({ body: opts.body === 'phial' ? 'phial' : 'phi', watchHold: opts.watchHold === true })

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    const usage: any = await $.session.usage().catch(() => null)
    const sessionId: unknown = await $.session.id().catch(() => '')
    setSession({
      cwd: e.cwd,
      key: projectKey(e.cwd),
      interactive: e.isInteractive,
      startedAt: typeof usage?.startedAt === 'number' ? usage.startedAt : now,
      sessionId: typeof sessionId === 'string' ? sessionId : '',
    })
    // The estate adapters (1.0): each off when its script is absent.
    const root = pluginRoot($)
    const adapters = await findAdapters($, e.cwd, root)
    setSession({ adapters, usageDir: usageDir(await homeDir($)) })
    // With nothing to look from, the band says `estate: ?` rather than drawing the companion's
    // own counts as if there were no estate (1.1): a lookup that could not run is not an absence.
    if (adapters.ticket === null && s.config.ticketScript === '' && root === '') {
      await update($, ticketAtom, () => UNAVAILABLE_TICKET)
    }
    await $.command.register({ name: 'undone', description: 'Witness: every ask this watch - witnessed, pale or open' })
    await $.command.register({
      name: 'wrap',
      description: 'Witness: end the watch and print what was and was not witnessed into the session log',
    })
    await $.command.register({
      name: 'tackle',
      description: `Witness: put ${estate() ? `an ${ESTATE_TACKLE_SKILL}` : 'a'} run over the undone asks in the prompt box, to read and send`,
    })
    // The costume seam (1.1, Bradley 2026-10-09): a later organ dresses Phi through $.command.run.
    await $.command.register({ name: 'wear', description: 'Witness: dress Phi - razor, compass, horns, or none' })
    await $.command.register({
      name: 'barnacles',
      description: 'Witness: what the barnacles on the shell record, and scrub them off',
    })
    // A refused registration costs the confirm tool, never the rest of the start.
    const person = s.config.person
    await $.tool
      .register({ name: 'confirm', description: confirmDescription(person), inputSchema: confirmSchema(person) })
      .catch(() => undefined)
    await loadStored($, now)
    if (!e.isInteractive) return next(e)
    const settings: any = await $.settings.read()
    if (estate()) {
      $.clock.after(0, () => refreshTicket($))
      $.clock.every(TICKET_MS, () => refreshTicket($))
    }
    $.clock.after(0, () => relieve($))
    $.clock.after(0, () => recurBarnacles($))
    $.clock.after(0, () => syncGoals($, now))
    if (settings?.prefersReducedMotion !== true) $.clock.every(FRAME_MS, () => stepFrame($))
    $.clock.every(HOUSEKEEP_MS, () => housekeep($))
    if (s.adapters.watch !== null) $.clock.every(POLL_MS, () => poll($))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    const mine = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (mine && s.watchHold && s.interactive) await takeWatch($, now)
    await update($, activityAtom, a => touch(a, now))
    if (mine) await update($, heardAtom, log => hear(log, { text: e.text, at: now }))
    // The print lands in the session log before the close skill reads it.
    // A project with no session log gets its print on the /close prompt instead.
    let closeNote: string | null = null
    if (mine && isCloseCommand(e.text, s.config.closeCommands)) {
      const printed = await writePrint($).catch(() => null)
      const summary = printed?.summary ?? 'The witness print could not be written.'
      await say($, 'PRINT', summary, true, now + PRINT_MS)
      if (printed !== null && printed.path === null) closeNote = closePrintNote(printed.print, estate())
    }
    const text = askableText(e.text)
    // The answer this prompt replies to, read now: the pass runs after the next turn may have started.
    const previous = s.lastAnswer
    if (mine && s.interactive && text.length > 0) $.clock.after(0, () => extractAsks($, text, now, previous))
    if (s.interactive) $.clock.after(0, () => syncGoals($, now))
    // A /tackle prompt lists the undone asks itself, so it carries no note; its turn is
    // recorded as `tackle` (0.5.0).
    const tackle = mine && isTacklePrompt(e.text)
    if (tackle) setSession({ tackleTurn: true })
    const note = mine && s.interactive && !tackle ? await takeNudge($) : null
    const notes = [closeNote, note].filter((n): n is string => n !== null)
    return next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('turn.start', async ($, e, next) => {
    await update($, turnAtom, () => e.turnId)
    return next(e)
  })

  on('tool.call', async ($, e: any, next) => {
    if (e.tool === CONFIRM_TOOL) {
      // A report is a claim, never its own read-back (1.1): only the main session confirms.
      if (e.agentId !== undefined) return { deny: SUBAGENT_CONFIRM }
      const { tool: _t, tool_use_id: _u, agentId: _a, ...input } = e
      return { result: await confirm($, input) }
    }
    let call = e
    if (isHeldSql(e)) {
      if (e.agentId !== undefined || !s.interactive) {
        try {
          await recordRun($, e, { deny: SUBAGENT_HELD })
        } catch {}
        return { deny: SUBAGENT_HELD }
      }
      const held = await holdWrite($, e)
      if (!held.pass) {
        try {
          await recordRun($, e, { deny: held.reason })
        } catch {}
        return { deny: held.reason }
      }
      call = held.e
    }
    const ran = await next(call)
    await recordRun($, call, ran)
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : isHeldSql(e) ? { deny: HOLD_FAILED } : next(e)))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const now = await $.clock.now()
    // What the turn cost (0.5.0): the denominator for the side passes' own cost.
    if (s.interactive) {
      const pass: UsagePass = e.agentId !== undefined ? 'agent' : s.tackleTurn ? 'tackle' : 'turn'
      const row = turnRow(pass, now, e.usage)
      if (row !== null) await appendUsage($, row).catch(() => undefined)
      if (e.agentId === undefined) setSession({ tackleTurn: false })
    }
    // A subagent's own turn: its final report is a claim of its own (1.1).
    if (e.agentId !== undefined) {
      await agentReport($, String(e.agentId), String(e.answer ?? ''), now)
      return done
    }
    setSession({ lastAnswer: String(e.answer ?? '').slice(-MAX_PREVIOUS_CHARS) })
    const cid = newIds(now, 1, 'c')[0] ?? `c${now}`
    let claimId: string | null = null
    await update($, ledgerAtom, l => {
      const r = recordTurn(l, { turnId: e.turnId, at: now, answer: e.answer, id: cid })
      claimId = r.claim?.id ?? null
      return r.ledger
    })
    const ledger = await read($, ledgerAtom)
    await update($, asksAtom, a => resolveStates(a, ledger))
    await update($, activityAtom, a => touch(a, now))
    const answer = e.answer
    const claimed = claimId
    $.clock.after(0, () => afterTurn($, now, claimed, answer))
    return done
  })

  on('session.end', async ($, e, next) => {
    await saveCarry($)
    await saveFriction($)
    return next(e)
  })

  on('command.run', { command: 'undone' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Undone' })
    const asks: Ask[] = await read($, asksAtom)
    const c = counts(asks)
    const carried = c.carried > 0 ? `, ${c.carried} carried in` : ''
    const builds = c.builds > 0 ? `, ${c.builds} build${c.builds === 1 ? '' : 's'} for the to-do list` : ''
    return { text: `Witness asks ${nm(asks)}${carried}${builds} - the list is open in the Undone pane.` }
  })

  on('command.run', { command: 'wrap' }, async $ => {
    const now = await $.clock.now()
    const printed = await writePrint($)
    await say($, 'PRINT', printed.summary, true, now + PRINT_MS)
    // The main session reads what was printed and settles it, as a turn of its own (Bradley,
    // 2026-10-08). /close does not: the close skill reads the log itself (Step 4b).
    if (s.interactive) $.clock.after(0, () => $.prompt.submit({ text: wrapReadPrompt(printed.print, printed.path, s.config.person, s.config.closeCommands[0]) }))
    return { text: printed.summary }
  })

  on('command.run', { command: 'tackle' }, async $ => ({ text: await tackle($) }))

  // /wear razor|compass|horns|none: what Phi holds, until changed or the session ends (1.1).
  on('command.run', { command: 'wear' }, async ($, e) => {
    const costume = parseCostume(e.args)
    if (costume === null) return { text: 'Usage: /wear razor | compass | horns | none' }
    await update($, costumeAtom, () => costume)
    return { text: costume === 'none' ? 'Phi wears nothing.' : `Phi wears the ${costume}.` }
  })

  // /barnacles: the problems the barnacles record, each with a scrub (1.1, Bradley 2026-10-09).
  on('command.run', { command: 'barnacles' }, async $ => {
    const list: Barnacle[] = await read($, barnaclesAtom)
    if (list.length === 0) return { text: 'No barnacles on the shell: nothing has recurred across sessions.' }
    await $.ui.open({ id: BARNACLES_PANE, title: 'Barnacles' })
    return { text: `${list.length} barnacle${list.length === 1 ? '' : 's'} on the shell - the list is open in the Barnacles pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: BARNACLES_PANE }, async ($, e) => {
    const list: Barnacle[] = await read($, barnaclesAtom)
    const onScrub = (key: string) => scrubBarnacles($, key)
    const onScrubAll = () => scrubBarnacles($, null)
    return barnaclesTree($.ui.resolve(e), list, onScrub, onScrubAll)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const asks = await read($, asksAtom)
    const ledger = await read($, ledgerAtom)
    // An agent's report is labelled as one (1.1).
    const pale = ledger.claims.filter(c => c.state === 'pale').map(c => ({ ...c, text: claimLabel(c) }))
    const onDrop = (id: string) => update($, asksAtom, list => dropAsk(list, id))
    const onTackle = async () => $.ui.toast(await tackle($))
    return paneTree($.ui.resolve(e), e.viewport?.rows ?? 24, paneRows(asks), pale, onDrop, onTackle)
  })

  // The band stays low over the prompt (Bradley, S162): the compact sprite always
  // (maxRows 0 keeps it compact), at the right edge facing its bubble.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    // Recorded from here, never from the pure render; written after the draw, not during it.
    const heads = beneathText(below)
    if (heads !== '' && !s.headsUp.includes(heads)) {
      setSession({ headsUp: [...s.headsUp, heads] })
      $.clock.after(0, () => hearBeneath($, heads))
    }
    // The notice queue (Bradley, 2026-10-09): one shown, `<n/m>` when more wait; a note from beneath is counted.
    const now = await $.clock.now()
    const beneath = heads !== ''
    const shown = showing(await read($, noticesAtom), beneath, now)
    const speech = shown.notice
    const onDismiss = dismissable(speech)
      ? async () => {
          const at = await $.clock.now()
          await update($, noticesAtom, q => dismiss(q, beneath, at))
        }
      : null
    const view = buildView({
      body: s.body,
      frameIndex: await read($, frameAtom),
      costume: await read($, costumeAtom),
      ledger: await read($, ledgerAtom),
      asks: await read($, asksAtom),
      activity: await read($, activityAtom),
      now,
      speech,
      hold: await read($, holdAtom),
      barnacles: await read($, barnaclesAtom),
      working: e.props.isWorking,
      rowsLanded: speech?.header === 'BOARD',
      maxRows: 0,
      bodyColumns: e.props.bodyColumns,
      facing: 'left',
    })
    const ticket = await read($, ticketAtom)
    const footer = { n: shown.n, m: shown.m, onDismiss }
    return bandTree($.ui.resolve(e), e.props.bodyColumns, view, below, EYE_ROW[s.body][view.size], ticket, footer)
  })
}
