import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type {
  Activity,
  Ask,
  Barnacle,
  Beat,
  BoardRow,
  Body,
  Candidate,
  Costume,
  Friction,
  Hand,
  Heard,
  Hold,
  Ledger,
  LogBinding,
  NoticeQueue,
  Observed,
  OpenFailure,
  Overlap,
  PodState,
  RepairPair,
  SonarView,
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
  sonarOn,
  typedHandsStart,
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
  REPORT_TOOLS,
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
import { asCarrySlot, carryPrefix, carrySlot, carrySlotKey, mergeCarried, takeable } from './carry'
import {
  archivable,
  asFrictionList,
  asFrictionSlot,
  frictionPrefix,
  frictionSlot,
  frictionSlotKey,
  mergeFriction,
  ownFriction,
} from './frictionslots'
import { podsTree } from './pods'
import { GUEST_MIN_BODY, GUEST_OWNER_PREFIX, bandTree, barnaclesTree, beneathText, paneTree, splitBeneath } from './render'
import { addPairs, asPairs, pairCandidates, pairLine, pairsSection } from './immunity'
import {
  TREATED_DESCRIPTION,
  TREATED_SCHEMA,
  TREATED_TOOL,
  isTreatPrompt,
  markTreating,
  parseTreated,
  treatPrompt,
  treatVerdict,
  treatedText,
} from './treat'
import { age, cure, noteFailure } from './repair'
import {
  BEAT_MS,
  HAND_TAG,
  HAND_TEXT_MAX,
  LIVE_MS,
  beatDays,
  beatFile,
  beatPath,
  findPod,
  freshOverlaps,
  handAction,
  handEnvelope,
  handFile,
  handPath,
  handPrompt,
  handsDir,
  isForgedHand,
  isWitnessHand,
  livePods,
  makeBeat,
  newcomers,
  originLabel,
  overlaps,
  parseBeat,
  parseHand,
  parseHandArgs,
  parseHandFile,
  podLabel,
  recentWrites,
  sonarDir,
  touchesSonar,
  unreadHand,
} from './sonar'
import { bandPods, newcomerText, overlapText, podRows } from './podview'
import { intrusions, recentTargets, storeOverlaps } from './territory'
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
const PODS_PANE = 'witness-pods'
// The model's own hand (1.2): it lands in the other pod's prompt box and waits for the person's Enter.
const HAND_TOOL = 'mcp__witness__hand'
const HAND_DESCRIPTION =
  "Hand a piece of work to another live Claude Code session (a pod) on this machine. It lands in that session's prompt box and waits for the person to read it and press Enter; it never starts work there on its own. `to` is the pod's number, name or id prefix as /pods lists it."
const HAND_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'string', description: "The pod: its number in /pods, its folder name, or the start of its session id." },
    text: { type: 'string', description: 'What the other session should do, self-contained: it has none of this conversation.' },
  },
  required: ['to', 'text'],
} as const
const SUBAGENT_HAND = 'witness: a subagent may not hand work to another session; report to the main session instead.'
const SONAR_FENCE =
  "witness: the sonar's files (~/.claude/state/witness-sonar) are written by the witness alone, so a hand typed by the person can never be forged. Use the hand tool."
const FORGED_HAND =
  "witness: a hand envelope is the witness's own. Use the hand tool, or ask the person to type /hand."
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
// The repair pairs (1.2): this project's, newest last, kept across sessions in $.store.
const repairsAtom = atom({ plugin: 'witness', key: 'repairs' } as const, [] as RepairPair[])
// The sonar (1.2): the other live pods, the files this pod and one of them both wrote, waiting hands.
const EMPTY_SONAR: SonarView = { pods: [], overlaps: [], waiting: [], at: 0 }
const sonarAtom = atom({ plugin: 'witness', key: 'sonar' } as const, EMPTY_SONAR)

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
  /** Failures waiting for their cure (1.2): the main session's own, lost on a reload. */
  opens: OpenFailure[]
  /** The sonar's folder (1.2); null when the sonar is off or the home is unknown. */
  sonarDir: string | null
  /** The home folder, for the shared ~/.claude places an overlap may sit in. */
  home: string | null
  /** The git repository's root, as the engine reads it; null outside one. */
  root: string | null
  /** This pod's state on the sonar: a main turn running, or between turns. */
  podState: PodState
  /** Pods in this repo already announced, and the overlaps already said: each said once. */
  noticedPods: string[]
  podOverlaps: Overlap[]
  /** Hands already taken (by message or by file): each taken once. */
  handsSeen: string[]
  /** A sonar sweep is running; the tick must not start a second. */
  sweeping: boolean
  /**
   * The sonar folder the fence keeps Claude's writes out of, in EVERY session with a known home,
   * the sonar on or off, headless included (the blind verifier's blocker, S170): a session with
   * its own sonar off could otherwise write a hand file for a pod whose sonar is on.
   */
  fenceDir: string | null
  /** The pods as last shown in the Pods pane, by session id: a /hand row number means these. */
  podsShown: string[]
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
  opens: [],
  sonarDir: null,
  home: null,
  root: null,
  podState: 'idle',
  noticedPods: [],
  podOverlaps: [],
  handsSeen: [],
  sweeping: false,
  fenceDir: null,
  podsShown: [],
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

/** This session's own name in the store: its id, else its start time. */
function selfId(): string {
  return s.sessionId !== '' ? s.sessionId : `session-${s.startedAt}`
}

/**
 * This session's leftovers into its OWN slot (1.2, ruled 2026-10-09): a live session's slot is
 * never taken by another, and `ended` (written at session end) is what makes it takeable.
 */
async function saveCarry($: any, ended = false): Promise<void> {
  const slot = carrySlot({ sessionId: selfId(), savedAt: await $.clock.now(), ended, asks: carryOver(await read($, asksAtom)) })
  await $.store.set(carrySlotKey(s.key, selfId()), slot)
}

/**
 * The leftovers of sessions in this project that have ended (or gone stale), each slot taken
 * once and deleted; the older single slot, if one is still stored, read the same way.
 */
async function takeCarried($: any, now: number): Promise<Ask[]> {
  const lists: Ask[][] = []
  const all: string[] = await $.store.keys().catch(() => [])
  for (const k of all.filter(x => x.startsWith(carryPrefix(s.key)))) {
    const slot = asCarrySlot(await $.store.get(k))
    if (slot === null || !takeable(slot, now, selfId())) continue
    lists.push(slot.asks)
    await $.store.delete(k).catch(() => undefined)
  }
  const legacy = await $.store.get(storeKeys(s.key).carry)
  if (Array.isArray(legacy)) {
    lists.push(legacy as Ask[])
    await $.store.delete(storeKeys(s.key).carry).catch(() => undefined)
  }
  return mergeCarried(lists)
}

/** This session's OWN friction into its own slot (1.2, ruled 2026-10-09): never over another pod's. */
async function saveFriction($: any): Promise<void> {
  const slot = frictionSlot({ sessionId: selfId(), savedAt: await $.clock.now(), entries: ownFriction(s.friction, s.startedAt) })
  await $.store.set(frictionSlotKey(s.key, selfId()), slot)
}

/**
 * The project's friction as every pod wrote it: the archive (the old single key) and every
 * session's slot, live or ended, merged. Slots untouched for a day are folded into the archive
 * and deleted, so the store stays bounded.
 */
async function loadFriction($: any, now: number): Promise<Friction[]> {
  const archiveKey = storeKeys(s.key).friction
  const archive = asFrictionList(await $.store.get(archiveKey))
  const lists: Friction[][] = [archive]
  const folded: Friction[][] = []
  const gone: string[] = []
  const all: string[] = await $.store.keys().catch(() => [])
  for (const k of all.filter(x => x.startsWith(frictionPrefix(s.key)))) {
    const slot = asFrictionSlot(await $.store.get(k))
    if (slot === null) continue
    lists.push(slot.entries)
    if (archivable(slot, now, selfId())) {
      folded.push(slot.entries)
      gone.push(k)
    }
  }
  if (gone.length > 0) {
    await $.store.set(archiveKey, mergeFriction([archive, ...folded]))
    for (const k of gone) await $.store.delete(k).catch(() => undefined)
  }
  return mergeFriction(lists)
}

async function loadStored($: any, now: number): Promise<void> {
  const keys = storeKeys(s.key)
  // Only ended sessions' leftovers (1.2): a live session's undone asks stay its own.
  const carried = await takeCarried($, now)
  if (carried.length > 0) {
    const seeded = seedCarried(carried, { at: now, ids: newIds(now, carried.length, 'k') })
    await update($, asksAtom, a => (a.length === 0 ? seeded : a))
  }
  // Every pod's friction, read; this session writes only its own (1.2). Legacy third-edit
  // entries are dropped: a file under build is work, not friction (1.1).
  setSession({ friction: realFriction(await loadFriction($, now)) })
  const stored = await $.store.get(keys.candidates)
  if (Array.isArray(stored)) await update($, candidatesAtom, () => stored as Candidate[])
  const pairs = asPairs(await $.store.get(keys.repairs))
  if (pairs.length > 0) await update($, repairsAtom, () => pairs)
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
 * Treat (1.2, ruled 2026-10-09): the barnacle's evidence goes into the prompt box for the session
 * to propose a fix, as /tackle does, never over a draft; the barnacle is marked in treatment so
 * the `treated` tool may take it off once the fix lands. On demand only, no model call here.
 */
async function treatBarnacle($: any, key: string): Promise<string> {
  const list: Barnacle[] = await read($, barnaclesAtom)
  const barnacle = list.find(b => b.key === key)
  if (barnacle === undefined) return 'That barnacle is no longer on the shell.'
  const box: any = await $.prompt.read().catch(() => ({ text: '' }))
  if (typeof box?.text === 'string' && box.text.trim() !== '') return 'Your prompt box holds a draft; clear it, then press Treat again.'
  const pairs: RepairPair[] = await read($, repairsAtom)
  const candidates: Candidate[] = await read($, candidatesAtom)
  const text = treatPrompt({ barnacle, friction: s.friction, pairs, candidates })
  const filled: any = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
  if (filled === null || filled?.isFilled === false) return 'The prompt box would not take the treatment.'
  const now = await $.clock.now()
  const next = markTreating(list, key, now)
  await update($, barnaclesAtom, () => next)
  await $.store.set(storeKeys(s.key).barnacles, next)
  return 'The treatment is in your prompt box: send it, and the session proposes a fix for you to accept or reject.'
}

/**
 * The `treated` tool: the session says the accepted fix has landed. Believed only for a barnacle
 * the person put in treatment, and only once something was written since; then the barnacle comes
 * off with the fix kept on its scrub record, so a regrowth says the fix did not hold.
 */
async function treated($: any, input: unknown): Promise<string> {
  const asked = parseTreated(input)
  if (asked === null) return 'Pass { key, fix }: the barnacle key from the treat prompt and one line saying what the fix was.'
  const list: Barnacle[] = await read($, barnaclesAtom)
  const barnacle = list.find(b => b.key === asked.key)
  const ledger: Ledger = await read($, ledgerAtom)
  const since = barnacle?.treating ?? Number.POSITIVE_INFINITY
  const verdict = treatVerdict(barnacle, ledger.writes.filter(w => w.at > since).length)
  if (!verdict.ok || barnacle === undefined) return `witness: not taken off. ${verdict.ok ? '' : verdict.reason}`
  const now = await $.clock.now()
  const keys = storeKeys(s.key)
  const next = scrub(list, asked.key)
  await update($, barnaclesAtom, () => next)
  await $.store.set(keys.barnacles, next)
  const scrubbed = asScrubbed(await $.store.get(keys.scrubbed))
  await $.store.set(keys.scrubbed, { ...scrubbed, [asked.key]: { at: now, text: treatedText(barnacle, asked.fix) } })
  await say($, 'TREATED', `${asked.key}: ${asked.fix}`, false, now + SPEAK_MS)
  return `Treated: the barnacle ${asked.key} is off the shell. If its friction comes back it regrows at once and says this fix did not hold.`
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

/**
 * The repair pair (1.2, Bradley 2026-10-09): a main-session call that failed opens an antigen
 * on its target; the next call that succeeds on that target is its cure, and the two are kept
 * as one pair with the diff between them and what the failing cost. A sub-agent's calls are
 * its own, as for friction.
 */
async function recordRepair(
  $: any,
  c: { tool: string; input: unknown; resultText: string; isError: boolean; at: number },
): Promise<void> {
  // What the model re-read to make a failed attempt: the bulk of a retry's cost (the plain call
  // costs nothing). Read before s.opens is, so no await falls between its read and its write:
  // parallel calls record concurrently and would otherwise lose each other's failures.
  const usage: any = c.isError ? await $.session.usage().catch(() => null) : null
  const context = typeof usage?.context?.tokens === 'number' ? usage.context.tokens : undefined
  const aged = age(s.opens, c.at)
  if (c.isError) {
    setSession({ opens: noteFailure(aged, { tool: c.tool, input: c.input, resultText: c.resultText, at: c.at, writers: s.writers, context }) })
    return
  }
  const r = cure(aged, { tool: c.tool, input: c.input, at: c.at, writers: s.writers })
  setSession({ opens: r.opens })
  if (r.pairs.length === 0) return
  // One store write at a time: two parallel cures would otherwise each overwrite the other's pair.
  const kept = pairWrites.then(() => keepPairs($, r.pairs, c.at))
  pairWrites = kept.catch(() => undefined)
  await kept
}

/** The tail of the pair writes, so keepPairs runs one at a time (lost on a reload, as nothing needs it). */
let pairWrites: Promise<void> = Promise.resolve()

/**
 * Keeps new pairs for the project, read fresh from the store so a second pod's are not lost.
 * An epitope that recurs (immune memory) becomes a hook or skill candidate at once, with no
 * side pass: the pair carries its own cure.
 */
async function keepPairs($: any, fresh: readonly RepairPair[], at: number): Promise<void> {
  const keys = storeKeys(s.key)
  const next = addPairs(asPairs(await $.store.get(keys.repairs)), fresh)
  await $.store.set(keys.repairs, next)
  await update($, repairsAtom, () => next)
  const existing: Candidate[] = await read($, candidatesAtom)
  const minted = pairCandidates(next, existing, at)
  if (minted.length === 0) return
  const merged = mergeCandidates(existing, minted)
  await update($, candidatesAtom, () => merged)
  await $.store.set(keys.candidates, merged)
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
  const repairs: RepairPair[] = await read($, repairsAtom)
  const extra = [
    ...notesSection({ friction: s.friction, spoken, since: s.startedAt }),
    '',
    ...pairsSection(repairs, s.startedAt),
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

// ---- the sonar (1.2): heartbeats, overlaps and hands between pods ----

/** This pod's name as another pod sees it: the folder, and the start of the session id. */
function selfLabel(): string {
  const name = s.cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? s.cwd
  return `${name} ${s.sessionId.slice(0, 4)}`
}

/** Writes this pod's heartbeat: its state, what it is on, and the files it wrote lately. */
async function writeBeat($: any, now: number): Promise<void> {
  if (s.sonarDir === null || s.sessionId === '') return
  const asks: Ask[] = await read($, asksAtom)
  const ledger: Ledger = await read($, ledgerAtom)
  const beat = makeBeat({
    sessionId: s.sessionId,
    cwd: s.cwd,
    root: s.root,
    startedAt: s.startedAt,
    now,
    state: s.podState,
    // This watch's own asks: a carried one is the previous session's (seen live, S170: a new pod
    // showed another pod's goal because the project's carry is written after every turn).
    goals: undone(asks)
      .filter(a => a.source !== 'carried')
      .map(a => a.text),
    asks: nm(asks),
    writes: recentWrites(ledger.writes, now),
    notion: recentTargets(ledger.writes, now, 'notion'),
    tables: recentTargets(ledger.writes, now, 'sql'),
  })
  await $.fs.write(beatPath(s.sonarDir, now, s.sessionId), beatFile(beat))
}

/** Every heartbeat written lately, today's and yesterday's folders; a stale or unreadable file is skipped. */
async function readBeats($: any, now: number): Promise<Beat[]> {
  const out: Beat[] = []
  for (const day of beatDays(now)) {
    const dir = `${s.sonarDir}/${day}`
    const entries: any[] = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      if (entry?.kind !== 'file' || !String(entry.name).endsWith('.json')) continue
      if (entry.mtimeMs > 0 && now - entry.mtimeMs > LIVE_MS) continue
      const text: string | null = await $.fs.read(`${dir}/${entry.name}`).catch(() => null)
      const beat = text === null ? null : parseBeat(text)
      if (beat !== null) out.push(beat)
    }
  }
  return out
}

/**
 * One sweep: beat, listen, and say what is new. A pod that arrives in this repo is said once;
 * a file this pod and another both wrote, in a place they share, is said once per pod.
 */
async function sonarTick($: any): Promise<void> {
  if (s.sonarDir === null || s.sweeping) return
  setSession({ sweeping: true })
  try {
    const now = await $.clock.now()
    await writeBeat($, now)
    const pods = livePods(await readBeats($, now), { now, self: s.sessionId })
    const ledger: Ledger = await read($, ledgerAtom)
    const mine = recentWrites(ledger.writes, now)
    // The same file, the same Notion page or table, and a write inside another live pod's
    // repository, of which both pods are told (the wider pings, ruled 2026-10-09).
    const found = [
      ...overlaps({ mine, myRoot: s.root, pods, home: s.home, now }),
      ...storeOverlaps({ notion: recentTargets(ledger.writes, now, 'notion'), tables: recentTargets(ledger.writes, now, 'sql'), pods, now }),
      ...intrusions({ mine, myRoot: s.root, pods, now }),
    ]
    const fresh = freshOverlaps(s.podOverlaps, found)
    const arrived = newcomers(s.noticedPods, pods, s.key)
    setSession({ podOverlaps: found, noticedPods: [...s.noticedPods, ...arrived.map(p => p.sessionId)] })
    await update($, sonarAtom, v => ({ ...v, pods, overlaps: found, at: now }))
    for (const pod of arrived) await say($, 'SONAR', newcomerText(pod), false, now + SPEAK_MS)
    if (fresh.length > 0) {
      $.ui.toast(`Overlap: ${overlapText(fresh[0]!)}`)
      await say($, 'OVERLAP', fresh.map(overlapText).join('; '), false, now + SPEAK_MS)
    }
    await takeHandFiles($)
    await fillWaiting($, null)
  } finally {
    setSession({ sweeping: false })
  }
}

/**
 * The pod a /hand names. A row number means the pods as the person last saw them in the Pods
 * pane, never a list re-sorted since (the verifier: a pod arriving between /pods and /hand 2
 * would have taken a typed hand meant for another). A name or id prefix is read against the
 * live list.
 */
function resolvePod(pods: readonly Beat[], ref: string): Beat | 'ambiguous' | 'unseen' | 'gone' | null {
  const r = ref.trim()
  if (!/^\d{1,2}$/.test(r)) return findPod(pods, r)
  if (s.podsShown.length === 0) return 'unseen'
  const id = s.podsShown[Number(r) - 1]
  if (id === undefined) return null
  return pods.find(p => p.sessionId === id) ?? 'gone'
}

/** Sends a hand to a live pod: by message, else as a file that pod reads on its next sweep. */
async function sendHand($: any, ref: string, text: string, typed: boolean): Promise<string> {
  if (s.sonarDir === null) return 'The sonar is off in this session, so no pod can be handed work.'
  const pods: Beat[] = (await read($, sonarAtom)).pods
  const pod = resolvePod(pods, ref)
  if (pod === null) return `No live pod matches "${ref}". /pods lists them.`
  if (pod === 'ambiguous') return `"${ref}" matches more than one pod; use its number from /pods.`
  if (pod === 'unseen') return 'Open /pods first: a pod number means the list you last saw there.'
  if (pod === 'gone') return `Pod ${ref} in the list you last saw is no longer live; open /pods again.`
  const now = await $.clock.now()
  const id = newIds(now, 1, 'h')[0] ?? `h${now}`
  const hand: Hand = { id, from: s.sessionId, fromName: selfLabel(), typed, text, at: now }
  const cut = text.trim().length > HAND_TEXT_MAX ? ` Only its first ${HAND_TEXT_MAX} characters went.` : ''
  const sent: any = await $.session
    .send({ to: { sessionId: pod.sessionId }, text: handEnvelope(hand) })
    .catch((err: any) => ({ isDelivered: false, reason: String(err?.message ?? err) }))
  const where = typed ? 'typed by you, so it starts there once that pod is idle' : "it waits in that pod's prompt box for an Enter"
  if (sent?.isDelivered === true) return `Hand ${id} delivered to ${podLabel(pod)}: ${where}.${cut}`
  await $.fs.write(handPath(s.sonarDir, pod.sessionId, id), handFile(hand, pod.sessionId, false))
  // A file is never trusted as typed (anyone on the machine can write one), so it only fills the box.
  return `Not delivered as a message (${sent?.reason ?? 'no reason given'}); left as a file ${podLabel(pod)} takes on its next sweep (within ${BEAT_MS / 1000} s). A hand left as a file never starts work on its own: it waits in that pod's prompt box for an Enter.${cut}`
}

/**
 * A hand arrives (1.2, rulings S165). One the person typed starts a turn here unattended, once
 * this pod is idle, and its words are asks here as they were there; one a Claude session wrote
 * goes into the prompt box and waits for the person's Enter, never over a draft.
 */
async function takeHand($: any, hand: Hand): Promise<void> {
  if (s.handsSeen.includes(hand.id) || hand.from === s.sessionId) return
  setSession({ handsSeen: [...s.handsSeen, hand.id] })
  const now = await $.clock.now()
  const box: any = await $.prompt.read().catch(() => ({ text: '' }))
  const boxEmpty = typeof box?.text !== 'string' || box.text.trim() === ''
  const typedStarts = typedHandsStart(s.config.typedHands, estate())
  const action = handAction({ typed: hand.typed, interactive: s.interactive, boxEmpty, typedStarts })
  const first = hand.text.split('\n')[0] ?? ''
  const said = `from ${hand.fromName}${hand.typed ? ' (typed)' : ' (from Claude)'}: ${first}`
  if (action === 'submit') {
    $.clock.after(0, () => extractAsks($, hand.text, now, ''))
    $.clock.after(0, () => $.prompt.submit({ text: handPrompt(hand, s.config.person) }).catch(() => undefined))
    await say($, 'HAND', said, false, now + SPEAK_MS)
    return
  }
  // The fill goes in before anything else is awaited, and appends: a key typed since the read is kept.
  const filled: any =
    action === 'fill' ? await $.prompt.fill({ text: handPrompt(hand, s.config.person), mode: 'append' }).catch(() => null) : null
  if (filled === null || filled?.isFilled === false) await update($, sonarAtom, v => ({ ...v, waiting: [...v.waiting, hand] }))
  await say($, 'HAND', said, false, now + SPEAK_MS)
}

/** Puts a waiting hand (the first, or `id`) in the prompt box once the box is empty. */
async function fillWaiting($: any, id: string | null): Promise<string> {
  const waiting: Hand[] = (await read($, sonarAtom)).waiting
  const hand = id === null ? waiting[0] : waiting.find(h => h.id === id)
  if (hand === undefined) return 'No hand is waiting.'
  const box: any = await $.prompt.read().catch(() => ({ text: '' }))
  if (typeof box?.text === 'string' && box.text.trim() !== '') return 'Your prompt box holds a draft; clear it and the hand goes in.'
  const filled: any = await $.prompt.fill({ text: handPrompt(hand, s.config.person), mode: 'append' }).catch(() => null)
  if (filled === null || filled?.isFilled === false) return 'The prompt box would not take the hand.'
  await update($, sonarAtom, v => ({ ...v, waiting: v.waiting.filter(h => h.id !== hand.id) }))
  return `The hand from ${hand.fromName} is in your prompt box: read it, then press Enter.`
}

/** The file fallback: hands left for this pod when a message could not be delivered. */
async function takeHandFiles($: any): Promise<void> {
  if (s.sonarDir === null || s.sessionId === '') return
  const dir = handsDir(s.sonarDir, s.sessionId)
  const now = await $.clock.now()
  const entries: any[] = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (entry?.kind !== 'file' || !String(entry.name).endsWith('.json')) continue
    const path = `${dir}/${entry.name}`
    const text: string | null = await $.fs.read(path).catch(() => null)
    const got = text === null ? null : parseHandFile(text)
    if (got === null || got.taken || got.to !== s.sessionId) continue
    await $.fs.write(path, handFile(got.hand, got.to, true))
    // Stale (a session id resumed hours later): marked taken, never acted on.
    if (now - got.hand.at > HAND_FILE_MAX_MS) continue
    // Never typed: a file can be written by anything on the machine, so it only fills the box
    // and waits for the person's Enter (the blind verifier's blocker, S170).
    await takeHand($, { ...got.hand, typed: false })
  }
}

/** How long a hand left as a file stays worth taking. */
const HAND_FILE_MAX_MS = 10 * 60_000

/**
 * Whether a call that names the sonar folder writes there. A file tool always does. A shell
 * command (Bash, PowerShell, Monitor) does when the ledger's own reading of it finds a write or a
 * command word it cannot vouch for (`other:shell`); `ls` or `cat` of a beat does not. A tripwire,
 * not a proof: a hand left as a file is never trusted as typed, so this guards tampering only.
 */
function fencedWrite(e: any): boolean {
  if (e.tool !== 'Bash' && e.tool !== 'PowerShell' && e.tool !== 'Monitor') return true
  const tool = e.tool === 'Monitor' ? 'Bash' : e.tool
  const input = { command: String(e.command ?? '') }
  const { writes } = classify({ tool, input, resultText: '', isError: false, isReadOnly: false, writers: s.writers })
  // Only a write INTO the folder, or a command word nobody can vouch for: `2>/dev/null` on a read
  // is not one (the Ammonite pod's field report, S170: two read-only commands were refused).
  return writes.some(w => w.kind === 'other' || w.target.toLowerCase().includes('witness-sonar'))
}

/** After a /clear: this pod beats under the new session id, idle, with nothing heard yet (F2). */
async function followClear($: any): Promise<void> {
  const id: unknown = await $.session.id().catch(() => s.sessionId)
  if (typeof id !== 'string' || id === '' || id === s.sessionId) return
  const now = await $.clock.now()
  setSession({ sessionId: id, startedAt: now, podState: 'idle', noticedPods: [], podOverlaps: [], podsShown: [] })
  await writeBeat($, now)
}

/** A main turn starting or ending moves this pod's state, said on the sonar at once. */
async function podTo($: any, state: PodState): Promise<void> {
  if (s.sonarDir === null || s.podState === state) return
  setSession({ podState: state })
  await writeBeat($, await $.clock.now()).catch(() => undefined)
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
    // A report tool's result is a sub-agent's word, never a cure or an antigen of its own.
    if (!REPORT_TOOLS.has(tool)) await recordRepair($, { tool, input, resultText, isError, at: now })
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
  if (isTacklePrompt(t) || isWrapReadPrompt(t) || isTreatPrompt(t)) return ''
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
    const home = await homeDir($)
    // The fence is armed in every session, before the interactive check (1.2, the verifier's blocker);
    // the pod's own sonar state starts over on a second start in one process (/clear).
    setSession({
      adapters,
      usageDir: usageDir(home),
      fenceDir: sonarDir(home),
      sonarDir: null,
      home: home ?? null,
      podState: 'idle',
      noticedPods: [],
      podOverlaps: [],
      podsShown: [],
    })
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
    // Treat (1.2): the session reports an accepted fix has landed; the witness checks before it believes.
    await $.tool.register({ name: 'treated', description: TREATED_DESCRIPTION, inputSchema: TREATED_SCHEMA }).catch(() => undefined)
    await loadStored($, now)
    if (!e.isInteractive) return next(e)
    // The sonar (1.2): where the estate is, unless set on or off; a headless run never beats.
    if (sonarOn(s.config.sonar, estate()) && s.sessionId !== '') {
      const repo: any = await $.session.repo().catch(() => null)
      setSession({ sonarDir: s.fenceDir, root: typeof repo?.root === 'string' ? repo.root : null })
    }
    if (s.sonarDir !== null) {
      await $.command.register({ name: 'pods', description: 'Witness: the other live sessions on the sonar, and the files you both wrote' })
      await $.command.register({ name: 'hand', description: 'Witness: hand work to another live session - /hand <number|name> <what to do>' })
      await $.tool.register({ name: 'hand', description: HAND_DESCRIPTION, inputSchema: HAND_SCHEMA }).catch(() => undefined)
      // A sweep that cannot read or write the folder costs that sweep, never the session.
      $.clock.after(0, () => sonarTick($).catch(() => undefined))
      $.clock.every(BEAT_MS, () => sonarTick($).catch(() => undefined))
    }
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
    await podTo($, 'working')
    return next(e)
  })

  on('tool.call', async ($, e: any, next) => {
    if (e.tool === CONFIRM_TOOL) {
      // A report is a claim, never its own read-back (1.1): only the main session confirms.
      if (e.agentId !== undefined) return { deny: SUBAGENT_CONFIRM }
      const { tool: _t, tool_use_id: _u, agentId: _a, ...input } = e
      return { result: await confirm($, input) }
    }
    if (e.tool === TREATED_TOOL) {
      if (e.agentId !== undefined) return { deny: 'witness: a subagent may not take a barnacle off; the main session reports a treated fix.' }
      const { tool: _t, tool_use_id: _u, agentId: _a, ...input } = e
      return { result: await treated($, input) }
    }
    if (e.tool === HAND_TOOL) {
      if (e.agentId !== undefined) return { deny: SUBAGENT_HAND }
      // Claude's own hand is never typed: it waits for the person's Enter over there (1.2).
      return { result: await sendHand($, String(e.to ?? ''), String(e.text ?? ''), false) }
    }
    // The sonar's files are the witness's alone (1.2), fenced in every session: a file tool there is
    // refused, and a shell command only when it writes (reading a beat to look is fine).
    if (s.fenceDir !== null && touchesSonar(e.tool, e, s.fenceDir) && fencedWrite(e)) {
      try {
        await recordRun($, e, { deny: SONAR_FENCE })
      } catch {}
      return { deny: SONAR_FENCE }
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
    await podTo($, 'idle')
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
    // Marked ended: only now may a later session in this project take these leftovers. The three
    // start together (F2, 2026-10-09): the end chain shares one short wall-clock bound, and a save
    // that failed kept the ended beat from ever being written.
    await Promise.allSettled([saveCarry($, true), saveFriction($), podTo($, 'ended')])
    const done = await next(e)
    // A /clear ends the conversation, not the process, and no session.start follows (engine
    // types, SessionEndInput): the pod follows the new id itself, or its next turn beats as the
    // old session, `working` again, and a hand sent to it by id goes nowhere.
    if (e.reason === 'clear') await followClear($).catch(() => undefined)
    return done
  })

  // A hand from another pod's witness (1.2): taken here, never read by the model as a message.
  // F8 (2026-10-09, live): a hand the parser could not read went on to the model, read mid-turn
  // with no Enter. Fail closed: anything with a witness stamp or the hand tag is taken, and what
  // cannot be read as a witness hand waits in the box as raw text, never typed.
  on('session.receive', async ($, e: any, next) => {
    if (e.agentId !== undefined) return next(e)
    const text = String(e.text ?? '')
    const witness = isWitnessHand(e.origin)
    if (!witness && !text.includes(HAND_TAG)) return next(e)
    const now = await $.clock.now()
    const hand = (witness ? parseHand(text, now) : null) ?? unreadHand(text, originLabel(e.origin), now)
    await takeHand($, hand)
    return { consumed: `witness hand ${hand.id} from ${hand.fromName}` }
  })

  // The model's own SendMessage may never carry a witness hand's envelope (1.2).
  on('session.send', async ($, e: any, next) => {
    if (isForgedHand({ originKind: String(e.origin?.kind ?? ''), text: String(e.text ?? '') })) {
      return { isDelivered: false, reason: FORGED_HAND }
    }
    return next(e)
  })

  // /pods: the other live sessions, what each is on, and the files you both wrote (1.2).
  on('command.run', { command: 'pods' }, async $ => {
    if (s.sonarDir === null) return { text: 'The sonar is off in this session.' }
    const view: SonarView = await read($, sonarAtom)
    // A /hand row number means this list, as the person saw it.
    setSession({ podsShown: view.pods.map(p => p.sessionId) })
    await $.ui.open({ id: PODS_PANE, title: 'Pods' })
    const n = view.pods.length
    const o = view.overlaps.length
    return { text: `${n} other live pod${n === 1 ? '' : 's'}${o > 0 ? `, ${o} overlap${o === 1 ? '' : 's'}` : ''} - the list is open in the Pods pane.` }
  })

  // /hand <pod> <text>: typed by the person (the composer or the bridge), it may start an idle pod's turn.
  on('command.run', { command: 'hand' }, async ($, e) => {
    const parsed = parseHandArgs(e.args)
    if (parsed === null) return { text: 'Usage: /hand <pod number|name|id> <what to do> (/pods lists the pods)' }
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    return { text: await sendHand($, parsed.ref, parsed.text, typed) }
  })

  on('ui.render', { component: 'Pane', requestId: PODS_PANE }, async ($, e) => {
    const view: SonarView = await read($, sonarAtom)
    const now = await $.clock.now()
    // The pane redraws as the sonar sweeps; the numbers on screen are the ones /hand means.
    setSession({ podsShown: view.pods.map(p => p.sessionId) })
    const onFill = async (id: string) => $.ui.toast(await fillWaiting($, id))
    return podsTree($.ui.resolve(e), podRows(view.pods, view.overlaps, now), view.waiting, onFill)
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
    if (costume === null) return { text: 'Usage: /wear razor | compass | horns | devil | none' }
    await update($, costumeAtom, () => costume)
    return { text: costume === 'none' ? 'Phi wears nothing.' : `Phi wears the ${costume}.` }
  })

  // /barnacles: the problems the barnacles record, each with a scrub (1.1, Bradley 2026-10-09).
  on('command.run', { command: 'barnacles' }, async $ => {
    const list: Barnacle[] = await read($, barnaclesAtom)
    const pairs: RepairPair[] = await read($, repairsAtom)
    if (list.length === 0 && pairs.length === 0) {
      return { text: 'No barnacles on the shell and no repair pairs: nothing has recurred, and no failure has been cured.' }
    }
    await $.ui.open({ id: BARNACLES_PANE, title: 'Barnacles' })
    // The repair pairs (1.2) sit under the barnacles: a cured failure is friction with its cure.
    const kept = pairs.length > 0 ? ` and ${pairs.length} repair pair${pairs.length === 1 ? '' : 's'}` : ''
    return { text: `${list.length} barnacle${list.length === 1 ? '' : 's'} on the shell${kept} - the list is open in the Barnacles pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: BARNACLES_PANE }, async ($, e) => {
    const list: Barnacle[] = await read($, barnaclesAtom)
    const pairs: RepairPair[] = await read($, repairsAtom)
    const onScrub = (key: string) => scrubBarnacles($, key)
    const onScrubAll = () => scrubBarnacles($, null)
    const onTreat = async (key: string) => $.ui.toast(await treatBarnacle($, key))
    return barnaclesTree($.ui.resolve(e), list, onScrub, onScrubAll, pairs.map(pairLine), onTreat)
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
    // The guest seam (1.3): a guest drawing standing narrow above the band puts the horns on Phi
    // for this draw only; the costume atom is never written.
    const guest: any = splitBeneath(below).guest
    const guestKey = guest?.props?.key
    const horned =
      guest !== null &&
      guest !== undefined &&
      e.props.bodyColumns < GUEST_MIN_BODY &&
      typeof guestKey === 'string' &&
      guestKey.startsWith(GUEST_OWNER_PREFIX)
    const view = buildView({
      body: s.body,
      frameIndex: await read($, frameAtom),
      costume: horned ? 'devil' : await read($, costumeAtom),
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
    // The sonar's part of the one line (1.2): `pods N`, `!K` in warning colour while files overlap.
    const pods: SonarView = await read($, sonarAtom)
    const sonar = s.sonarDir === null ? null : { text: bandPods(pods.pods, pods.overlaps), warn: pods.overlaps.length > 0 }
    return bandTree($.ui.resolve(e), e.props.bodyColumns, view, below, EYE_ROW[s.body][view.size], ticket, footer, sonar)
  })
}
