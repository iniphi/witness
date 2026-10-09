# witness

A Claude Code mod that keeps track of what you asked for and what was proven done, and holds risky SQL writes for your answer.

witness is a plugin of function hooks. It sits in the session beside you, keeps a ledger of your asks, and counts an ask as done only when there is evidence: a read-back of what was written, or your own words. It draws one line above the prompt with a small companion beside it.

## What it does

- **The asks ledger.** A Haiku side pass reads each prompt you type and records the asks in it. If the session keeps a log, the checkbox items under its Goals heading are added too. The band shows `asks n/m`, where n is the number witnessed. `/undone` lists every ask as witnessed, pale (claimed but not proven) or open. Standing instructions ("explain as we go") are not recorded. Work that spans several sessions is listed apart as `builds N` and is never counted. Text you quote or paste is not read as an ask. At the end of a watch, an open ask nobody claimed carries into the next one once, shown apart as `carried N`.
- **Claims develop only on read-back.** When the agent says something is done, the claim stays pale until a later read of the same target lands, such as a file read, a SELECT or a fetch. A claim whose matched asks are all witnessed develops with them. The agent cannot certify its own write.
- **The `execute_sql` hold.** A Supabase MCP `execute_sql` UPDATE or DELETE that has no RETURNING clause is held, and you choose: add RETURNING, let it through once, or cancel. A headless run (`claude -p`) or a subagent has nobody to ask, so there the write is refused. witness never approves a call past another guard.
- **The confirm tool.** The agent reports a finished ask through the `confirm` tool and must cite evidence: a tool result already in the session, or your words. It can mark an ask dropped only on your words. A close paraphrase of an ask is accepted when exactly one live ask clearly matches. If a turn calls something done without proof, the next prompt carries one short line asking the agent to confirm it.
- **The print.** `/wrap` writes a Witness print into the open session log: asks witnessed, pale and open, writes held, friction, notes taken, and hook or skill candidates. It then hands the print to the main session, which settles what is done and says what each open line waits on, without starting new work. The close command (default `/close`) writes the same print before it runs. A project with no session log gets the print attached to the close prompt.

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
| `body` | `phi` | The companion's body: `phi` (nautilus) or `phial` (round-bottom flask). |
| `watchHold` | `false` | At session start, and after five idle minutes, ask before the first prompt goes through. |
| `ticketScript` | empty | A script that prints a status ticket as JSON, as a path relative to the session folder or absolute. If it is empty and no ticket script sits beside the mod, there is no ticket, and the line shows the companion's own counts. |
| `watchScript` | empty | A script that reads a work board for the watch and its poll. If it is empty and none is found, no board is polled. |
| `writerCalls` | `workspace.close_todo, workspace.set_todo_status, workspace.pause_todo, workspace.crosstalk_*, workspace.record_board_attention, workspace.claim_item, workspace.release_claim` | SQL functions that a SELECT calls to write, written as `schema.name`, where a trailing `*` matches any suffix. These count as writes. The list does nothing where that schema does not exist. |
| `person` | `you` | How the print and the confirm tool name you. The default prints "on your words", and the model reads "the user". |
| `sessionsDir` | `.claude/sessions` | Where session logs live, relative to the session folder. |
| `goalsHeading` | `## Goals` | The session log heading whose checkbox items are goals. The section ends at the next heading of the same level. |
| `closeCommands` | `/close` | Commands that close a session, separated by commas. The print is written before they run. |

## Commands

- `/undone` lists every ask in this watch: witnessed, pale or open.
- `/wrap` ends the watch, writes the print into the session log and hands it to the main session to settle.
- `/tackle` puts a prompt in the prompt box for a run over the undone asks. You read it and decide whether to send it. It never sends on its own.
- **Dismiss.** There is no `/dismiss` command. While witness is showing a notice that can be dismissed, a `0: Dismiss` button sits at its foot, bound to the `0` key. A held write is never dismissed, only answered. When more than one notice is waiting, `<n/m>` shows your place in the queue.

## Footprint

**What it reads:**

- the prompts you type;
- the tool calls the session makes and their results (to match claims against read-backs);
- the open session log in `sessionsDir`;
- your Claude Code settings;
- the output of `ticketScript` and `watchScript`, if they are set or found.

**What it writes:**

- `~/.claude/state/witness-usage/<day>/<session>.json`: the token counts the API reported for each of witness's own side passes and each model turn. Nothing is written if neither `USERPROFILE` nor `HOME` is set.
- The Witness print, appended to the open session log at `/wrap` and at the close command.
- Hook and skill candidates, appended to `reports/witness-candidates.md` when the session folder has a `reports/` folder, and to `.claude/witness-candidates.md` otherwise.
- The plugin's own store in Claude Code, which keeps the carried asks, friction, candidates and held-write notes from one session to the next.

**What it sends to a model:** the side passes are extract, match, candidates and barnacles. They run on Haiku at low effort. Each pass sees only what it is given: the prompt, with quoted and pasted text cut out, and short excerpts of answers and tool output. No other conversation content is sent. The only text witness adds to the main session's context is the one-line unproved-done note and the `/wrap` print.

## Cost

witness's own spend is its Haiku side passes. Measured on the author's machine over one day of
ordinary use (eleven sessions, API list prices), the side passes came to $0.07 in total, about
$0.006 per session, which was 0.03% of what the model turns in those sessions cost. Per call,
the extract pass reads about 1,000 tokens, match about 1,400, candidates about 8,200 and
barnacles about 1,300.

The usage file records every model turn's tokens beside the side passes, so a session's whole
spend can be read next to witness's share. Those turn figures are the session's cost, not
witness's. witness does not price the work of subagents a session spawns: their tokens are
recorded only as the host reports them, and nothing in the band follows what they do.

## Development

```
claude plugin validate <path to witness>
claude plugin test <path to witness>
```

The pure modules in `hooks/` each have a `*.test.ts` beside them. `hooks/register.tsx` is the hooks module, the only file that calls the engine.

## Security

To report a vulnerability, see `SECURITY.md`. Please do not open a public issue for one.

## License

MIT. Copyright (c) 2026 Bradley Higginson. See `LICENSE`.
