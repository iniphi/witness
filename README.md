# witness

A Claude Code mod that keeps track of what you asked for and what was proven done, and holds risky SQL writes for your answer.

witness is a plugin of function hooks. It sits in the session beside you, keeps a ledger of your asks, and counts an ask as done only when there is evidence: a read-back of what was written, or your own words. It draws one line above the prompt with a small companion beside it.

## What it does

- **The asks ledger.** A Haiku side pass reads each prompt you type and records the asks in it. If the session keeps a log, the checkbox items under its Goals heading are added too; the log is the one this session itself created or opened, never another session's. The band shows `asks n/m`, where n is the number witnessed. `/undone` lists every ask as witnessed, pale (claimed but not proven) or open. Standing instructions ("explain as we go") are not recorded. Work that spans several sessions is listed apart as `builds N` and is never counted. Text you quote or paste is not read as an ask. At the end of a watch, an open ask nobody claimed carries into the next one once, shown apart as `carried N`.
- **Claims develop only on read-back.** When the agent says something is done, the claim stays pale until a later read of the same target lands, such as a file read, a SELECT or a fetch. A claim whose matched asks are all witnessed develops with them. The agent cannot certify its own write. A subagent's final report is a claim too: it stays pale until the main session reads back what the report rests on, and a report is never evidence for the confirm tool.
- **The `execute_sql` hold.** An `execute_sql` UPDATE or DELETE that has no RETURNING clause is held (any MCP tool whose name ends `__execute_sql`, or the tools named in `sqlTools`), and you choose: add RETURNING, let it through once, or cancel. A headless run (`claude -p`) or a subagent has nobody to ask, so there the write is refused. witness never approves a call past another guard.
- **The confirm tool.** The agent reports a finished ask through the `confirm` tool and must cite evidence: a tool result already in the session, or your words. It can mark an ask dropped only on your words. A close paraphrase of an ask is accepted when exactly one live ask clearly matches. If a turn calls something done without proof, the next prompt carries one short line asking the agent to confirm it.
- **The print.** `/wrap` writes a Witness print into the open session log: asks witnessed, pale and open, writes held, friction, notes taken, and hook or skill candidates. It then hands the print to the main session, which settles what is done and says what each open line waits on, without starting new work. The close command (default `/close`) writes the same print before it runs. A project with no session log gets the print attached to the close prompt.
- **The companion.** A nautilus (or a flask, by `body`) at the right of the band, facing the line. Its colour deepens as more of the session's claims are proved. A chime of three bells hangs at its back, an hour of active work each, filling from the bottom with a half bell for thirty minutes; `*` barnacles on its shell are friction that recurs across sessions (a cancelled or refused write, a call that keeps failing, an MCP tool's error; never the edits of a file you are building), and `/barnacles` lists what they record and scrubs them off; its eye turns amber in a repository whose push would start a metered build, and the whole creature turns red while a write is held, while a write is refused by another guard, and while a statement sends back far more rows than it named (the haemorrhage). Part of the shell blushes red for any other irreversible call, by who can undo its effects: the rim alone when you can undo it yourself, the rim and the walls when undoing it will not get everything back, the rim, walls and top when nobody can (a DROP or an unpinned bulk write, a force push, a sent email; a plain git push depends on whether the repo is metered), and the bubble says which and how. A blush lights as the call goes out and stays 8 seconds after it. For one moment at session start the whole creature shows red, a lamp test that proves the red works. The blush says "not checked" for effects it has no register for (builds, webhooks, triggers outside the tables you list). A `◈` gem on the shell is a hook (green) or skill (blue) candidate you have not settled yet. A candidate is only minted if nothing already covers it (the side pass is shown the repo's `scripts/` and the headings of your `CLAUDE.md` files, and must say why nothing listed does the job) and if it recurs in at least two sessions, since one session's repeats (and one parallel message of failures) are recorded but not minted; recurring repair pairs likewise need two sessions, and a routine that works can count in two sessions through the sessions' routine heads; gems and barnacles share four cells. The bells, the barnacles and the gems wear their own inks. `/wear` dresses it in a costume.
- **The guest seam (1.3).** The band root is keyed `witness-band`. A mod folded beneath the witness can return a host keyed `witness-guest` holding its own drawing first and what stood beneath it second; the witness lifts the guest out (never reading its words as a heads-up note) and draws it: from 104 body columns in a left column of 38.2%, with the band laid out in the rest; narrower, above the band at full width. The engine's own node stays at the band root, under no sized Box. While a guest from a mod that names its drawing with the `ammonite-` key prefix stands narrow, the companion wears the `devil` horns for that draw only.

## Install

From a terminal:

```
claude plugin marketplace add https://github.com/iniphi/witness
claude plugin install witness@iniphi-witness
```

Or at the prompt of a terminal session:

```
/plugin install witness --marketplace iniphi/witness
```

Answer `y` to add the marketplace and choose a scope. Install it once. Two copies loaded in one session would run every hook twice.

## Configuration

Set these with `/config` or when you install. Every key is optional.

| Key | Default | What it does |
|---|---|---|
| `body` | `naut` | The companion's body: `naut` (the nautilus, Naut) or `phial` (round-bottom flask). `phi`, the nautilus's older name, is still accepted and means the same body. |
| `watchHold` | `false` | At session start, and after five idle minutes, ask before the first prompt goes through. |
| `ticketScript` | empty | A script that prints a status ticket as JSON, as a path relative to the session folder or absolute. If it is empty and no ticket script sits beside the mod, there is no ticket, and the line shows the companion's own counts. The mod looks beside itself from the folder Claude Code reports for it, or from its own file when that is blank; if it has nowhere to look from, the line shows `estate: ?` rather than nothing. |
| `watchScript` | empty | A script that reads a work board for the watch and its poll. If it is empty and none is found, no board is polled. |
| `writerCalls` | empty | SQL functions that a SELECT calls to write, written as `schema.name`, where a trailing `*` matches any suffix (for example `app.finish_task, app.log_*`). These count as writes. With none listed, a SELECT is a read. |
| `sqlTools` | `mcp__*__execute_sql` | The database tools whose queries the hold judges, as a comma-separated list of tool names where `*` matches any run of characters. The default matches any MCP tool whose name ends `__execute_sql`, a name several database servers share. Set it if your server names its query tool otherwise. |
| `tableSchemas` | `public` | Schemas whose `schema.table` names in a subagent's report count as targets that report named. Add your own, for example `public, app`. |
| `person` | `you` | How the print and the confirm tool name you. The default prints "on your words", and the model reads "the user". |
| `sessionsDir` | `.claude/sessions` | Where session logs live, relative to the session folder. |
| `goalsHeading` | `## Goals` | The session log heading whose checkbox items are goals. The section ends at the next heading of the same level. |
| `closeCommands` | `/close` | Commands that close a session, separated by commas. The print is written before they run. |
| `sonar` | `auto` | Heartbeats between the sessions running on this machine, overlap alerts and `/hand`. `auto` turns it on only where a ticket script is found; `on` and `off` force it. It writes small files under `~/.claude/state/witness-sonar` (see Footprint). |
| `pointInTimeRecovery` | `false` | Whether your database can restore lost rows by a point-in-time restore. On: a DROP, TRUNCATE or unpinned bulk write blushes the rim and walls (rung 2). Off or unknown: the top too (rung 3), because unknown fails closed. |
| `haemorrhageRows` | `25` | An UPDATE or DELETE with RETURNING that sends back more rows than it named, and more than this, turns the whole creature red (HAEMORRHAGE). Display only. |
| `lampTest` | `true` | Show the whole creature red for 1.5 seconds at session start, to prove the red channel. |
| `effectTables` | empty | Tables whose writes can reach outside the database (a trigger that calls a webhook or a build), comma-separated, `*` anywhere. A write to one blushes at least the rim and walls. Empty: the witness says triggers on a written table are not in `effectTables`. |
| `typedHands` | `auto` | Whether a `/hand` you typed in another session starts work in the receiving session without an Enter. `auto` allows it only where a ticket script is found; `start` always; `wait` never. A hand is recognised by a plugin stamp that Claude Code passes on as the sender's own claim, so any installed plugin could claim it; `wait` is the safe choice, and is what `auto` gives you without a ticket script. |

## Commands

- `/witness` opens a pane in which the companion introduces itself: the creature (the compact one the band draws), a readout of what it is watching in this session, what is new in 1.3, and the commands.
- `/undone` lists every ask in this watch: witnessed, pale or open.
- `/wrap` ends the watch, writes the print into the session log and hands it to the main session to settle.
- `/tackle` puts a prompt in the prompt box for a run over the undone asks. You read it and decide whether to send it. It never sends on its own.
- `/barnacles` opens a pane with what each barnacle on the shell records, and `treat` and `wash` beside each. **Treat** puts the barnacle's evidence in your prompt box for Claude to propose one fix; once you accept it and it lands, Claude's `treated` call takes the barnacle off (only for one you put in treatment, and only after something was written). **Wash** takes it off with no fix, for a false alarm; `wash all` washes every one. Either way, the moment the same friction is recorded again it is back, unspoken, so you hear it again: the fix or the wash did not hold. When a hook or skill candidate waits, one line says so and points to `/jewels`. Under the barnacles the pane lists the project's repair pairs: a call that failed, the call that cured it, what changed between them and roughly what the failed attempts cost.
- `/jewels` opens a pane with every hook or skill candidate you have not settled, newest first and in full: a `◈` gem (green for a hook, blue for a skill, as on the shell), the title, why it was proposed, the evidence, when it was seen and whether it has been filed to the candidates file. Under each, **take** puts the candidate in your prompt box for Claude to propose how to build it (never over a draft; the gem goes off only once the box took it) and **dismiss** takes it off with no build; With two or more listed, `calibrate all` puts every listed jewel in your prompt box as one numbered batch ask (kind, title, why, evidence) for Claude to give a read on, check adversarially and bring rulings in batches; the jewels are taken only once the box took it, and never over a draft. There is no `dismiss all`: a bulk dismissal is permanent and skipped the calibration, so the bulk path is `calibrate all`. The list is read fresh from the store each time, so a candidate another session in the project proposed shows at once. Jewels are per project: another project's surface as gems on the shell when a session opens in that project, and the pane lists this project's only. With no surface to place a pane, `/jewels` answers with the same content as text. A new install shows at most three new jewels a day for its first week; the rest are queued ("N more queued (first-week budget)") and shown on later days, never dropped. A jewel from a single session is minted only when it names a gap (a gate that does not run, or a check rebuilt by hand that no script holds). Filing candidates at /wrap does not take a gem off; settling does. The page ends with `Settled: built n, taken m, dismissed o.` `calibrate all` settles every listed jewel as taken, so once the batch is ruled, record each ruling (1.12): `/jewels taken` lists the taken jewels, numbered, with their state and key; `/jewels built 2 3` and `/jewels dismissed 4 5` (numbers or keys) record it on top of the taken settle. Only a taken jewel is ruled, once: the same ruling again changes nothing, a ruling is never changed, and a jewel that is not taken is refused. A jewel ruled dismissed joins the dismissed shapes the generator is shown; a built one does not (it was acted on).
- `/reds` lists this project's last 20 safelight events across sessions, newest first: when, which session, the channel (the lamp test, a blush, a hold, a refusal beneath, a haemorrhage), amber or red, why it lit, the fix, and how it ended. The print at /wrap and before a close carries a short Safelight section when the session had a red event. A blush that "you can undo" is amber; a refused write is whole red for 10 seconds, then amber until your next prompt, once per burst.
- `/pods` (sonar on) lists the other live sessions on this machine: what each is on, when it last beat, and any file you both wrote. The one line shows `pods N`, with `!K` in the warning colour while K files overlap. An overlap is reported after the fact, never before: each session beats and reads the others every 30 seconds, so you hear of a shared write up to about a minute after it, and two writes to one file inside that gap both land before either session is told. The sonar does not lock, block or prevent a write. It tells you where to look.
- `/hand <number|name> <what to do>` (sonar on) hands work to another live session. A hand you type waits in that session's prompt box for your Enter, or, where `typedHands` allows it, starts that session's turn once it is idle. A hand Claude writes (its `hand` tool) lands in that session's prompt box and waits for your Enter; it never starts work on its own and never goes over a draft.
- `/wear razor`, `/wear compass`, `/wear horns`, `/wear devil` dress the companion for the session; `/wear none` undresses it. A costume is how a later companion plugin shows which role is speaking, and another plugin can set one through the same command.
- **Dismiss.** There is no `/dismiss` command. While witness is showing a notice that can be dismissed, a `0: Dismiss` button sits at its foot, bound to the `0` key. A held write is never dismissed, only answered. When more than one notice is waiting, `<n/m>` shows your place in the queue, and its `<` and `>` are buttons: click `>` for the next notice and `<` for the one before, without dismissing any (including Claude Code's own note). With the band focused (ctrl+x tab), Enter presses the one the focus is on. While a write is held it stays in the bubble and there is no pager. A digit typed into an empty prompt presses the band button that has it, so start a message with a word while the `0: Dismiss` button shows.

## Footprint

**What it reads:**

- the prompts you type;
- the tool calls the session makes and their results (to match claims against read-backs);
- the open session log in `sessionsDir`;
- your Claude Code settings;
- the output of `ticketScript` and `watchScript`, if they are set or found;
- with the sonar on, the other sessions' heartbeat files and any hand file left for this session.

**What it writes:**

- `~/.claude/state/witness-usage/<day>/<session>.json`: the token counts the API reported for each of witness's own side passes and each model turn. Nothing is written if neither `USERPROFILE` nor `HOME` is set.
- The Witness print, appended to the open session log at `/wrap` and at the close command.
- Hook and skill candidates, appended to `reports/witness-candidates.md` when the session folder has a `reports/` folder, and to `.claude/witness-candidates.md` otherwise.
- The plugin's own store in Claude Code, which keeps the carried asks, friction, repair pairs, candidates and held-write notes from one session to the next. A repair pair keeps one line of each call's input (at most 300 characters), never its result. Each session writes its own friction slot (each entry names the session that recorded it) and its own routines slot, `routines:<project>:<session id>`: up to 60 call HEADS with a count of calls and of turns, for example `git commit`, an MCP tool's name, or `Edit .ts`. A routines slot holds no arguments, no paths, no file contents, no SQL and no prompt text; it lets a hook or skill candidate be seen to recur across two sessions. A slot untouched for a day is folded into a bounded archive (the newest 20 sessions) and deleted.
- With the sonar on: `~/.claude/state/witness-sonar/<day>/<session>.json`, this session's heartbeat every 30 seconds, holding the folder, up to three of its open asks (one line each), the asks count and the paths of the files it wrote in the last 30 minutes; and, when a hand cannot be delivered as a message, `~/.claude/state/witness-sonar/hands/<session>/<hand>.json`. Nothing prunes old day folders yet. A hand that arrives as a file is never treated as typed by you: it only waits in the prompt box. Claude's writes into that folder (its file tools, and a shell command that writes) are refused in every session, so the heartbeats cannot be tampered with from inside Claude; reading them is allowed.

**What it sends to a model:** the side passes are extract, match, candidates and barnacles. They run on Haiku at low effort. Each pass sees only what it is given: the prompt, with quoted and pasted text cut out, and short excerpts of answers and tool output. The candidates pass also sees the names and first comment line of the scripts in the session folder's `scripts/`, and the `#`/`##` headings of the project and user `CLAUDE.md` files, so it can tell what already exists. No other conversation content is sent. The only text witness adds to the main session's context is the one-line unproved-done note, the `/wrap` print, and a hand from another session (submitted when you typed it there, otherwise left in the prompt box for you to send).

## Cost

witness's own spend is its Haiku side passes, and what witness measures is tokens. The
comparison here is against new material: the input, output and cache writes the sessions
produced, with cache reads left out. On the author's machine over five days of ordinary use
(2026-10-07 to 2026-10-11, read at about 10:30 UTC on the last day), the sessions produced
about 42 million tokens of new material (42.6 million), and witness's side passes were about
1.86 million of them: about 4.4%, or 4.6% against the sessions' own new material alone. Per
session the side passes used a median of about 52,000 tokens (mean about 50,000, range 564 to
143,000, over the 37 sessions that ran one). The 2.07 billion cache reads those sessions also
made are not counted. Per call, the extract pass uses about 1,250 tokens, match about 1,700,
candidates about 10,000 and barnacles about 1,000.

Any dollar figure is an approximation. Priced at Anthropic's API list prices (as of
2026-10-08), the same five days come to about $0.28 for witness's side passes against about
$864 for the sessions' own model turns. These are computed, not billed: no bill has been
checked against either figure, so read them as a scale, not a cost. Every figure here is summed from the usage files described under Footprint, which you
can read for your own machine; the author keeps monitoring them.

The usage file records every model turn's tokens beside the side passes, so a session's whole
spend can be read next to witness's share. Those turn figures are the session's cost, not
witness's. witness does not price the work of subagents a session spawns: their tokens are
recorded only as the host reports them. Since 1.1 a subagent's final report is a claim in the
ledger, pale until the main session reads back what the report rests on.

## Development

```
claude plugin validate <path to witness>
claude plugin test <path to witness>
```

The pure modules in `hooks/` each have a `*.test.ts` beside them. `hooks/register.tsx` is the hooks module, the only file that calls the engine.

## Contributing

Issues and pull requests are welcome. witness is developed in a separate source repository and published here at each release, so the maintainer applies an accepted pull request there, with credit in the CHANGELOG, rather than merging it here.

## Security

To report a vulnerability, see `SECURITY.md`. Please do not open a public issue for one.

## License

MIT. Copyright (c) 2026 Bradley Higginson. See `LICENSE`.
