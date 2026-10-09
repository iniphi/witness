// The witness mod's type contract: every value it keeps in $.state, and the
// shapes its pure modules pass between them. One place these are written.

export type Body = 'phi' | 'phial'
export type Size = 'full' | 'compact'
export type Mood = 'calm' | 'resting' | 'alert' | 'shielding' | 'doubtful' | 'proud'

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
}

export type Claim = {
  id: string
  turnId: string
  /** First 160 characters of the answer that made the claim. */
  text: string
  at: number
  writeIds: string[]
  state: 'pale' | 'developed'
}

export type TurnStat = { calls: number; reads: number; writes: number }

export type Ledger = {
  writes: Write[]
  claims: Claim[]
  turns: Record<string, TurnStat>
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
  kind: 'cancelled-write' | 'tool-failure' | 're-edit' | 'let-through' | 'returning-added'
  /** What recurs: a tool name, a file path, a table. */
  key: string
  at: number
  detail: string
}

export type Barnacle = {
  key: string
  text: string
  spoken: boolean
}

/** Something the companion said in its bubble, kept for the print's "Notes taken" (S163). */
export type Spoken = { header: string; text: string; at: number }

/**
 * A proposal that something the witness saw could become a hook (an event-bound guard or
 * check) or a skill (a repeated multi-step procedure). Proposed only, never built (S163).
 * `filed` once appended to the running candidates file.
 */
export type Candidate = {
  key: string
  kind: 'hook' | 'skill'
  title: string
  why: string
  evidence: string
  at: number
  filed: boolean
}

/** A held write: the SQL as Claude sent it, and the CTE form offered, when there is one. */
export type Hold = { toolUseId: string; sql: string; fixed: string | null; at: number }

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
      watch: Watch
      barnacles: Barnacle[]
      frame: number
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
    }
  }
}
