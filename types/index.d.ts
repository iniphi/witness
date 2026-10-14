// The witness mod's type contract: every value it keeps in $.state, and the
// shapes its pure modules pass between them. One place these are written.

export type Body = 'phi' | 'phial'
// The full-size companion was removed in 1.3.9; one size remains.
export type Size = 'compact'
export type Mood = 'calm' | 'resting' | 'alert' | 'shielding' | 'doubtful' | 'proud'

/** A prop Naut can hold or wear: a costume for a later organ (FAMILY.md, 2026-10-09). */
export type Prop = 'razor' | 'compass' | 'horns' | 'devil'
/** What Naut wears now; set by the /wear command, `none` by default. */
export type Costume = Prop | 'none'

/** What the speech box says. `full` asks for the full sprite (one of the four moments). */
export type Speech = {
  /** Header in the box's top border: YOU SHOULD KNOW, HELD, WATCH S161 -> S162, PRINT. */
  header: string
  text: string
  full: boolean
  /** Epoch ms after which the speech clears; null holds it until replaced. */
  until: number | null
}

/** Who voices a notice, in screen-budget order (FAMILY.md section 4). */
export type NoticeKind = 'held' | 'beneath' | 'own' | 'guest'

/** One thing the bubble voices, waiting its turn (the notice queue, 2026-10-09). */
export type Notice = Speech & {
  id: string
  kind: NoticeKind
  /** Epoch ms it arrived; orders notices of one kind. */
  at: number
}

/** Every notice waiting, in showing order; `seen` counts those already passed since it was last empty. */
export type NoticeQueue = {
  items: Notice[]
  seen: number
  /**
   * 1.3.8 (Bradley, 2026-10-11: "the arrows don't switch between claims"): the id of the notice
   * paged to (`<beneath>` for the engine's own note); absent or gone, the head shows.
   */
  pinned?: string
}

/** Kinds of write the ledger tracks, each witnessed by a read of the same kind. */
export type WriteKind = 'file' | 'sql' | 'notion' | 'git' | 'migration' | 'trigger' | 'other'

/** One classified write or read from a tool call. `target` is normalised (see witness.ts). */
export type Touch = { kind: WriteKind; target: string }

export type Classified = {
  writes: Array<Touch & { selfWitnessed: boolean }>
  reads: Touch[]
}

export type Write = Touch & {
  id: string
  turnId: string
  at: number
  witnessed: boolean
  /** Set when a subagent made the write (1.1): it rides the main turn's id, and is attributed here. */
  agentId?: string
}

export type Claim = {
  id: string
  turnId: string
  /** First 160 characters of the answer that made the claim. */
  text: string
  at: number
  writeIds: string[]
  state: 'pale' | 'developed'
  /**
   * Set on a subagent's final report (1.1): that agent's id, and the claim's turnId is
   * `agent:<id>`. Such a claim is pale at birth and develops only on the main loop's read-back.
   */
  agentId?: string
  /** An agent claim's write ids that no main-loop read has covered since the report. */
  unread?: string[]
  /** An agent claim resting on no known write: targets its report names; one main-loop read of one develops it. */
  names?: Touch[]
}

export type TurnStat = { calls: number; reads: number; writes: number }

export type Ledger = {
  writes: Write[]
  claims: Claim[]
  turns: Record<string, TurnStat>
  /** Tool calls seen per subagent id (1.1): a report from an agent that made none mints no claim. */
  agents?: Record<string, number>
}

/** How a main-loop file call touched a session log: a Write created it, an Edit or a Read opened it. */
export type LogTouchKind = 'write' | 'edit' | 'read'

/**
 * The session log this watch follows (1.1), bound by the main loop's own file calls, never
 * found by listing the folder: two sessions in one repo no longer converge on the newest log.
 */
export type LogBinding = {
  /** The log's path, forward slashes, as the fs is given it. */
  path: string
  /** The strongest touch so far: a Write outranks an Edit, which outranks a Read. */
  by: LogTouchKind
  at: number
}

export type AskState = 'open' | 'claimed' | 'witnessed' | 'dropped'
/** `build`: work the person set for several sessions (0.6.0); held apart, made a to-do at /close. */
export type AskSource = 'ask' | 'goal' | 'carried' | 'build'

export type Ask = {
  id: string
  text: string
  source: AskSource
  state: AskState
  /** The ledger claim this ask rides on once claimed; its state decides witnessed. */
  claimId: string | null
  at: number
  /** Set when the ask was witnessed through the confirm tool: what the mod itself checked. */
  witness?: AskWitness
  /** Set when the user called the ask off and the confirm tool found their words (0.6.2). */
  calledOff?: { refs: string[]; at: number }
  /**
   * Set when the close triage (the log's `## Witness triage`) settled the ask (0.8.0):
   * `dismissed` (dropped, with the close's quoted evidence) or `to-do` (routed to the board).
   */
  settled?: 'dismissed' | 'to-do'
}

/**
 * A confirmation the mod verified for itself (S162): every piece of evidence cites a
 * tool call it observed in this session (a substring of that call's input, and an
 * excerpt found in its real output), or words the user typed. Never a claim.
 */
export type AskWitness = { by: 'evidence' | 'user'; refs: string[]; at: number }

/** One tool call the mod saw, kept so the confirm tool can check evidence against it. */
export type Observed = {
  toolUseId: string
  tool: string
  /** The call's input as text (a Bash command, a query, a path), trimmed. */
  input: string
  /** The call's result as the model read it, trimmed. */
  result: string
  isError: boolean
  agent: boolean
  at: number
  /** The turn the call fell in (witness's own turn id); absent on a call recorded before turns were kept. */
  turn?: string
}

/** One of the user's own prompts (composer or bridge origin), kept as a witness source. */
export type Heard = { text: string; at: number }

export type Activity = {
  /** Active milliseconds this watch; a gap over five minutes is not counted. */
  activeMs: number
  /** Epoch ms of the last prompt, tool call or turn end; null before the first. */
  lastAt: number | null
}

export type Friction = {
  /**
   * `let-through`: Bradley released a held bare write once (the spec's "logged to insights").
   * `returning-added`: he answered a hold with the RETURNING rewrite (S164: the third answer).
   */
  /** `re-edit` (a third edit of one file) is retired since 1.1: a file under build is work, not friction; stored entries are dropped on load. */
  kind: 'cancelled-write' | 'tool-failure' | 're-edit' | 'let-through' | 'returning-added'
  /** What recurs: a tool name, a file path, a table. */
  key: string
  at: number
  detail: string
  /**
   * The session that recorded it (1.9, "Two sessions"): a jewel needs its friction in two sessions.
   * Absent on friction stored before sessions were kept: all of it counts as ONE unknown session.
   */
  session?: string
}

export type Barnacle = {
  key: string
  text: string
  spoken: boolean
  /** Epoch ms the person pressed Treat in /barnacles (1.2): the session may now propose a fix and, once it lands, take it off. */
  treating?: number
}

/**
 * A failing call's antigen (1.2, the repair pair): what failed and on what. `code` and `kind`
 * are provisional cuts; `reason` keeps the raw first line so a later pass can re-cut them.
 */
export type Antigen = {
  tool: string
  /** SQLSTATE (`42703`) for a SQL failure, else an error class: refused, not-found, validation, http-<status>, timeout, string-not-found, other. */
  code: string
  /** The code read as a disease: undefined-column, undefined-table, syntax, unique-violation, ...; `code` itself when unknown. */
  kind: string
  /** The epitope's target: `schema.table.column` for an undefined column, a table, a file path, a bare 32-hex Notion id, else the tool name. */
  target: string
  /** The offending fragment (a column name, an id, a path), one line, at most 120 characters; '' when none. */
  fragment: string
  /** The error's first line as it came, one line, at most 160 characters. */
  reason: string
}

/** A failure waiting for its cure: every attempt so far on one epitope (`code|target`). */
export type OpenFailure = {
  key: string
  antigen: Antigen
  /** Every target the failed call named, normalised; a later success naming any of them cures it. */
  targets: string[]
  attempts: number
  /** Estimated tokens of every failed attempt: (input + result characters) / 4. */
  cost: number
  /** The last failed call's tool and input, one line, at most 300 characters. */
  lastTool: string
  lastInput: string
  firstAt: number
  lastAt: number
  /** Main-session calls seen since the last attempt: the window closes at REPAIR_WINDOW_CALLS. */
  since: number
  /** The failed call set out to write: then only a call that writes cures it (a read is the investigation). */
  write?: boolean
  /** The last failed call's whole input line (up to 2000 characters), so a fix past `lastInput`'s 300 is still a diff. */
  lastFull?: string
  /**
   * The input tokens the model was answered over when it made each failed attempt, summed: the
   * context every retry re-reads (mostly cache reads), from `$.session.usage()`. Absent when the
   * engine gave none. The bulk of what a misfire costs, which `cost` alone leaves out.
   */
  reread?: number
}

/** Where a cure differs from its failure: `content` (a hook), `route` (a skill line), `none` (weather). */
export type RepairDiff = { where: 'content' | 'route' | 'none'; removed: string[]; added: string[] }

/** A repair pair (1.2): a failed call and the call that cured it, with what the failing cost. */
export type RepairPair = {
  key: string
  antigen: Antigen
  failures: number
  failedTool: string
  failed: string
  cureTool: string
  cured: string
  diff: RepairDiff
  cost: number
  firstAt: number
  /** When cured: also the last time this cure was confirmed against the live system. */
  at: number
  /** A guard refused a call that then went through unchanged: an antibody fired on a healthy call. */
  autoimmune: boolean
  /** The context the failed attempts re-read, summed (OpenFailure.reread); absent when not measured. */
  reread?: number
  /**
   * The turn the cure fell in, as `<sessionId>:<turnId>`. Absent on a pair stored before turns were
   * kept: it has no session, and all such pairs count as ONE unknown session (1.9).
   */
  turn?: string
}

/** A pod's state on the sonar (1.2): a turn running, between turns, or gone. */
export type PodState = 'working' | 'idle' | 'ended'

/** A file a pod wrote, normalised as the ledger keeps it (lower-case, forward slashes). */
export type PodWrite = { path: string; at: number }

/** One running session's heartbeat file (the sonar, 1.2): `~/.claude/state/witness-sonar/<day>/<session>.json`. */
export type Beat = {
  format: 'witness-sonar'
  version: 1
  sessionId: string
  /** The session's folder as `projectKey` gives it. */
  repo: string
  /** The git repository's root, normalised; null outside one. */
  root: string | null
  /** The folder's last segment, as written (`my_project`). */
  name: string
  startedAt: number
  beatAt: number
  state: PodState
  /** Up to three of this watch's open asks or goals, one line each, at most 90 characters. */
  goals: string[]
  /** The asks count as the band shows it (`3/7 ~1`). */
  asks: string
  /** The newest file writes of this watch, at most 20, distinct paths. */
  writes: PodWrite[]
  /** The Notion pages written lately (bare 32-hex ids), at most 20; absent from an older beat (additive, version 1). */
  notion?: PodWrite[]
  /** The tables written lately by a direct statement (not a SELECT-led writer function), at most 20. */
  tables?: PodWrite[]
}

/**
 * What one overlap is (1.2, ruled 2026-10-09): `file`, `notion` or `table` when both pods wrote
 * the same thing; `into-theirs` when this pod wrote inside another live pod's repository, and
 * `into-mine` when another pod wrote inside this one's. Absent reads as `file`.
 */
export type OverlapKind = 'file' | 'notion' | 'table' | 'into-theirs' | 'into-mine'

/** A thing this pod and another both touched recently, or a write into another live pod's repository. */
export type Overlap = { path: string; peer: string; peerName: string; at: number; kind?: OverlapKind }

/** A hand between pods (1.2). `typed`: the person typed it (/hand from the composer); else a Claude session wrote it. */
export type Hand = { id: string; from: string; fromName: string; typed: boolean; text: string; at: number }

/** What the sonar last heard: the live pods, the overlaps, and hands waiting for an empty prompt box. */
export type SonarView = {
  pods: Beat[]
  overlaps: Overlap[]
  waiting: Hand[]
  /** Epoch ms of the last sweep; 0 never. */
  at: number
}

/** Something the companion said in its bubble, kept for the print's "Notes taken" (S163). */
export type Spoken = { header: string; text: string; at: number }

/**
 * A proposal that something the witness saw could become a hook (an event-bound guard or
 * check) or a skill (a repeated multi-step procedure). Proposed only, never built (S163).
 * `filed` once appended to the running candidates file. `settled` (1.5, Bradley 2026-10-11)
 * is a different thing: the person took it up or dismissed it from the Barnacles pane. A
 * candidate with no `settled` shows as a gem on the shell, filed or not, so rows stored
 * before 1.5 show as gems until they are settled.
 */
export type Candidate = {
  key: string
  kind: 'hook' | 'skill'
  title: string
  why: string
  evidence: string
  at: number
  filed: boolean
  /** `retired` (1.11.1): folded in from a stray subfolder slot; never shown or counted, and not fed to the generator as dismissed. */
  settled?: { how: 'taken' | 'dismissed' | 'retired'; at: number }
  /** `ruled` (1.12): the ruling after a calibration, recorded on top of a `taken` settle (never on any other); absent on every older record. */
  ruled?: { how: 'built' | 'dismissed'; at: number }
}

/** A held write: the SQL as Claude sent it, and the CTE form offered, when there is one. */
export type Hold = { toolUseId: string; sql: string; fixed: string | null; at: number }

/** A write another guard refused beneath the witness (1.4.0): the red's second channel. Display only. */
export type Refusal = {
  /** The layer that refused, in words: "a PreToolUse hook (supabase-sql-verdict.py)". */
  layer: string
  /** The refusal's reason line, trimmed. */
  reason: string
  tool: string
  /** When the burst's first refusal came: the whole-creature red runs from here, not from the latest. */
  at: number
  until: number
  /** The notice queued for it, so a new prompt takes both away. */
  noticeId: string
  /** Refusals in this burst (1.10.0); absent or 1 is a single one. */
  count?: number
}

/** The safelight blush (1.7): part of the shell reddens for an irreversible call, by who can undo it. */
export type Blush = {
  /** 1 rim, 2 rim and walls, 3 rim, walls and top. */
  rung: 1 | 2 | 3
  /** The bubble's text, kept so a result can renew the notice's expiry. */
  text: string
  at: number
  /** While the call is in flight a ceiling; once it returns, the result plus BLUSH_MS. */
  until: number
  noticeId: string
}

/** Far more rows came back than the statement named (1.7): the creature goes fully red. Display only. */
export type Haemorrhage = {
  rows: number
  named: number
  table: string
  at: number
  until: number
  noticeId: string
}

/** One open board row, as witness-watch.py returns it. */
export type BoardRow = { id: string; from: string; subject: string; createdAt: string }

/** The payload of scripts/witness-watch.py --json. A null was not measured. */
export type WatchInfo = {
  project: string | null
  boardId: string | null
  lastSession: { number: number; date: string; summary: string | null; outstanding: string[] } | null
  focus: string | null
  inbox: BoardRow[] | null
  codeTodosOpen: number | null
  /** The metered verdict word (UNMETERED, METERED, UNKNOWN, NO REGISTER); null not measured. */
  metered: string | null
  errors: string[]
}

export type Watch = {
  state: 'pending' | 'taken'
  info: WatchInfo | null
  takenAt: number | null
}

/**
 * What a usage row measured: one of the witness's Haiku side passes (0.4.0), or a model
 * turn (0.5.0) - a main-loop turn, a turn a /tackle prompt started, or a subagent's turn.
 */
export type UsagePass = 'extract' | 'match' | 'candidates' | 'barnacles' | 'turn' | 'tackle' | 'agent'

/** One call's or one turn's cost, as the API reported it. */
export type UsageRow = {
  at: number
  pass: UsagePass
  ok: boolean
  in: number
  out: number
  cacheRead: number
  cacheWrite: number
  /** The model that answered a turn; side passes run on SIDE_PASS's alias. */
  model?: string
}

/** The estate ticket from scripts/estate-status.py (folded in from the estate-status mod, 0.3.0). */
export type Ticket =
  | {
      kind: 'ok'
      /** Hex colour of the bar and tag, or null for no bar and the default colour. */
      colour: string | null
      tag: string
      inbox: string
      todos: string
      push: string
      warnInbox: boolean
      warnPush: boolean
    }
  | { kind: 'unavailable' }

declare module 'claude-code' {
  interface PluginState {
    witness: {
      ledger: Ledger
      asks: Ask[]
      activity: Activity
      /** Everything the bubble voices, one shown at a time (2026-10-09). */
      notices: NoticeQueue
      hold: Hold | null
      /** A write another guard refused (1.4.0), until it lapses or the next prompt. */
      refusal: Refusal | null
      /** The blush of an irreversible call (1.7), until it lapses. */
      blush: Blush | null
      /** Many more rows than named (1.7), until it lapses or the next prompt. */
      haemorrhage: Haemorrhage | null
      /** The lamp test's end (1.7), epoch ms; null when it is not showing. */
      lamp: number | null
      watch: Watch
      barnacles: Barnacle[]
      frame: number
      /** The costume Naut wears this session (1.1); `none` until /wear sets one. */
      costume: Costume
      /** The running turn's id, kept across a mid-turn hot reload so its writes stay in its claim. */
      turn: string
      /** The newest tool calls seen (capped), the evidence the confirm tool checks. */
      observed: Observed[]
      /** The user's newest prompts (capped), the evidence for what only they can witness. */
      heard: Heard[]
      /** What the companion said this watch (capped), for the print's Notes taken. */
      spoken: Spoken[]
      /** Hook and skill candidates for this project, carried across sessions in $.store. */
      candidates: Candidate[]
      /** When the candidate pass last ran (epoch ms; 0 = never this session). */
      candidateScanAt: number
      /** The estate ticket the one line opens with; null until first read this session. */
      ticket: Ticket | null
      /** This session's Haiku side passes and what each cost (0.4.0). */
      usage: UsageRow[]
      /** The session log this watch is bound to (1.1); null until the main loop touches one. */
      log: LogBinding | null
      /** This project's repair pairs (1.2), newest last, carried across sessions in $.store. */
      repairs: RepairPair[]
      /** The sonar (1.2): the other live pods, overlaps, and hands waiting for the prompt box. */
      sonar: SonarView
    }
  }
}
