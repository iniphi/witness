# Security policy

witness runs inside your Claude Code session. It reads your prompts and the session's tool calls, it can hold a SQL write for your answer, and it writes files into your project. A flaw in it can matter, so please report one privately.

## Supported versions

Only the latest release receives security fixes. Today that is 1.0.x.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem.

Include the witness version, your Claude Code version, what you did, what happened and what you expected. A minimal reproduction helps most.

witness has one maintainer, so responses are best effort. You should hear back within seven days. When a fix is released, the advisory is published, with credit to you if you want it.

## In scope

- A way past the `execute_sql` hold: an UPDATE or DELETE with no RETURNING clause that reaches the database without your answer, or a "let it through once" that covers more than the one write.
- A held write sent in a different form from the one witness showed you.
- witness approving a tool call that another guard refused.
- witness writing anywhere other than the places listed under Footprint in the README.
- Session content sent anywhere other than witness's own side passes, which run through Claude Code's model call.
- Text from a prompt, a tool result or a session log that reaches the main session's context through witness beyond the one-line note and the `/wrap` print, or that makes the `confirm` tool mark an ask done without evidence.
- witness running a script other than the `ticketScript` and `watchScript` you configured, or the ones the README says it looks for beside the mod.

## Out of scope

- Claude Code itself, the Supabase MCP server and other plugins. Report those to their maintainers.
- The hold as a security boundary. It is a safety net against a write that names nothing it touched. It covers one tool's UPDATE and DELETE statements and will not stop a determined or compromised agent. A statement it does not cover is a feature request, unless it is one of the bypasses above.
- The token cost of the side passes.
