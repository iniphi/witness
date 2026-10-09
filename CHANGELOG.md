# Changelog

## 1.0.0 - 2026-10-09

- 2026-10-09: A claim develops when it has at least one matched ask and every ask it matched is witnessed (`developByAsks` in `hooks/witness.ts`, run after the confirm tool and after each ask match). Writes the witness cannot read back (an `other:*` SQL function call, a git push) no longer keep such a claim pale for good; a claim no ask matched behaves as before.
- 2026-10-09: The candidate pass is shown the installed guards and mods (`INSTALLED_GUARDS` in `hooks/notes.ts`), is told never to propose a hook one already covers, and a hook candidate that restates one is filtered out (`coveringGuard`).
- 2026-10-09: Three `register.test.ts` cases pin the print on the close command when no open session log exists: nothing undone, an already-closed log, and no log at all. No code change: a report of a missing print traced to a session still running 0.5.1.
- 2026-10-09: A note from beneath (Claude Code's Heads up) is recorded once per distinct text in the print's Notes taken, under `HEADS UP` (`beneathText` in `hooks/render.tsx`, `noteHeard` in `hooks/notes.ts`).
- 2026-10-09: The notice queue. Everything the bubble voices waits in one queue (`hooks/notices.ts`, state `witness.notices` replacing `witness.speech`), ordered held write, note from beneath, the witness's own speech, costume guest; none is dropped. One shows at a time with `0: Dismiss` at its foot (hotkey `0`) and `<n/m>` after it when more than one waits. A held write is answered, never dismissed. The bubble grows no taller.
- 2026-10-09: The core/estate split. New pure module `hooks/config.ts` reads seven new `userConfig` fields (`ticketScript`, `watchScript`, `writerCalls`, `person`, `sessionsDir`, `goalsHeading`, `closeCommands`), each defaulting to the author's own setup.
- 2026-10-09: The ticket and the watch are adapters. With no `ticketScript` set, `scripts/estate-status.py` is looked for in the mod's folder and up to three folders above it; absent, there is no ticket, no ticket timer and no `estate: ?`, and the line is the companion's own counts. `scripts/witness-watch.py` likewise; absent, no helper run, no board poll, and the watch is taken quietly. Neither is ever looked for in the session's own folder.
- 2026-10-09: The writer-call list the classifier treats as SQL writes is config (`writerCalls`); `writerCalls` in `hooks/sql.ts` takes the pattern, threaded through `classify`.
- 2026-10-09: The person is config: confirm-tool evidence source is `user` (and `by: 'user'`, refs `user@<at>`). The confirm tool's description and schema, the hold's cancel reason and the /wrap read prompt name "the user" by default, or the configured `person`; a drop reads "called off on your words".
- 2026-10-09: Session logs: folder (`sessionsDir`), goals heading (`goalsHeading`, the section ending at the next heading of the same level) and close commands (`closeCommands`) are config.
- 2026-10-09: /tackle names `/agile` only where its ticket script was found; otherwise the prompt opens "Tackle the undone asks the witness holds for this session:". Both forms are recognised as a /tackle prompt and cut when quoted.
- 2026-10-09: Usage files go to `~/.claude/state/witness-usage` from `USERPROFILE` or `HOME`, and none is written when neither is set.
- 2026-10-09: Tests: `hooks/config.test.ts` (new), and `register.test.ts` cases for a Claude Code with no ticket or watch script (no ticket, no watch, no poll, no crash; a generic /tackle; a configured ticket script run from the session folder).
- 2026-10-09: Packaged for a public repository: `README.md` (what it does, install, every config key, commands, footprint, measured cost), `LICENSE` (MIT), this changelog, a public description in `plugin.json`, version 1.0.0. The public repository is a scrubbed export of the source, with its own marketplace file (`iniphi-witness`).
- 2026-10-09: Comments and test fixtures scrubbed of private references: internal report ids, private page ids and URLs, and home-folder paths are replaced by neutral wording and placeholder values. No behaviour change; the suite passes unchanged in count.

## Earlier versions

- 0.9.0 - 2026-10-08: `confirm` takes a close paraphrase when one live ask clearly wins (never a tie), and the unproved-done note names each ask's id, so a confirm is one call. A project with no session log gets its print on the close prompt.
- 0.8.1 - 2026-10-08: Quoted and pasted text (a pasted block, a quoted /tackle prompt) is cut before the extract pass and is never minted as an ask.
- 0.8.0 - 2026-10-08: The ledger reads the session log both ways: a Goal restating a typed ask takes it over, and the close triage's dismissed and to-do lines settle the asks they quote. The candidate pass sees installed commands and proposes no skill one already covers.
- 0.7.1 - 2026-10-08: Accuracy fixes: friction is the main session's own, a cancelled write is a refusal and never row data, the extract pass leaves out a plan's method steps and adds no word the user did not write, /tackle leaves hands-on work to the user.
- 0.7.0 - 2026-10-08: `/wrap` hands its print to the main session as a turn of its own, which settles what is done and starts no new work.
- 0.6.2 - 2026-10-08: The confirm tool takes `outcome: "dropped"` for an ask called off, on the user's words only; "can we also have X?" is no longer minted as an ask.
- 0.6.1 - 2026-10-08: An approval ("greenlight") is read against the end of the answer it approves; the confirm tool lists carried asks apart.
- 0.6.0 - 2026-10-08: A multi-session build is held apart as `builds N`, never counted; a standing instruction is not recorded.
- 0.5.1 - 2026-10-08: Only an open, unclaimed ask carries into the next watch, one hop, shown apart as `carried N`; a goal rescoped or removed in the log retires its old ask.
- 0.5.0 - 2026-10-08: Every model turn's cost is recorded beside the side passes; an ask a turn called done without proof is put to the agent once on the next prompt.
- 0.4.0 - 2026-10-08: Every Haiku side pass records the token counts the API reported to `~/.claude/state/witness-usage/`.
- 0.3.3 - 2026-10-08: The confirm tool says which part of a long output it keeps.
- 0.3.2 - 2026-10-08: The companion's eyes turn amber in a repo whose push triggers a metered build; plainer confirm wording.
- 0.3.1 - 2026-10-08: An unmeasured watch is still taken when the hold is off.
- 0.3.0 - 2026-10-08: The witness draws the status ticket itself, so two mods no longer compose one band.
- 0.2.0 - 2026-10-07: Substitutions became commands; the start-of-session watch hold is off by default; ready for user-scope install.
- 0.1.0 - 2026-10-07: First build: the companion, the asks ledger, the claim ledger, the `execute_sql` hold, the confirm tool, `/undone`, `/wrap` and `/tackle`, and the Witness print.
