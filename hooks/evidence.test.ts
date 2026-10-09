import { test, expect } from 'claude-code/testing'

import type { Ask, Heard, Observed } from '../types'
import {
  CONFIRM_DESCRIPTION,
  CONFIRM_SCHEMA,
  CONFIRM_TOOL,
  OBSERVED_CAP,
  RESULT_HEAD,
  RESULT_TAIL,
  bearsOut,
  confirmAsks,
  confirmReport,
  findAsk,
  inputText,
  isReport,
  observe,
  parseItems,
  trimResult,
  unprovedNote,
} from './evidence'

const ask = (id: string, text: string, at = 100, state: Ask['state'] = 'open'): Ask => ({
  id,
  text,
  source: 'ask',
  state,
  claimId: null,
  at,
})

const call = (o: Partial<Observed>): Observed => ({
  toolUseId: 't1',
  tool: 'Bash',
  input: 'claude plugin test mods/witness',
  result: ' 175 pass\n 0 fail\nRan 175 tests across 13 files.',
  isError: false,
  agent: false,
  at: 200,
  ...o,
})

test('a read-back made after the ask, with the excerpt in its output, bears the evidence out', () => {
  const e = { source: 'call' as const, command: 'plugin test mods/witness', excerpt: '175 pass 0 fail' }
  expect(bearsOut(e, [call({})], [], 100)).toEqual('t1')
})

test('evidence fails when the call came before the ask, errored, or the excerpt is not in the output', () => {
  const e = { source: 'call' as const, command: 'plugin test', excerpt: '175 pass' }
  expect(bearsOut(e, [call({ at: 50 })], [], 100)).toBeNull()
  expect(bearsOut(e, [call({ isError: true })], [], 100)).toBeNull()
  expect(bearsOut({ ...e, excerpt: '176 pass' }, [call({})], [], 100)).toBeNull()
  expect(bearsOut({ ...e, command: 'pytest' }, [call({})], [], 100)).toBeNull()
})

test('a command cannot manufacture its own proof: an excerpt that is in the input fails', () => {
  const echo = call({ input: 'echo "all items verified and done"', result: 'all items verified and done' })
  const e = { source: 'call' as const, command: 'echo', excerpt: 'all items verified and done' }
  expect(bearsOut(e, [echo], [], 100)).toBeNull()
})

// 1.1 (ruled 2026-10-09): a subagent's report is a claim the main session reads back, never evidence.
test("a report is never evidence: an Agent, Task, TaskOutput or Workflow result, or a subagent's own call", () => {
  const e = { source: 'call' as const, command: 'plugin test mods/witness', excerpt: '175 pass 0 fail' }
  for (const tool of ['Agent', 'Task', 'TaskOutput', 'Workflow']) {
    expect(bearsOut(e, [call({ tool, input: '{"prompt":"run claude plugin test mods/witness"}' })], [], 100)).toBeNull()
  }
  expect(bearsOut(e, [call({ agent: true })], [], 100)).toBeNull()
  expect(bearsOut(e, [call({})], [], 100)).toEqual('t1')
  expect(CONFIRM_DESCRIPTION).toContain("subagent's report")
})

test("observe keeps no subagent call: it could never be cited, and would crowd out the main loop's", () => {
  expect(observe([], call({ agent: true }))).toEqual([])
  expect(observe([], call({})).map(o => o.toolUseId)).toEqual(['t1'])
  expect(isReport({ tool: 'Agent', agent: false })).toBe(true)
  expect(isReport({ tool: 'Bash', agent: true })).toBe(true)
  expect(isReport({ tool: 'Bash', agent: false })).toBe(false)
})

// Seen live (S163): an MCP result arrives JSON-encoded, so a quoted excerpt the model read
// as "status":"resolved" sat in the stored output as \"status\":\"resolved\" and failed.
test('a quoted excerpt matches an MCP result whose quotes arrived JSON-escaped', () => {
  const mcp = call({
    tool: 'mcp__claude_ai_Supabase__execute_sql',
    input: 'SELECT status FROM workspace.router_inbox',
    result: '{"result":"[{\\"row_id\\":\\"row-0042\\",\\"status\\":\\"resolved\\"}]"}',
  })
  const e = { source: 'call' as const, command: 'FROM workspace.router_inbox', excerpt: '"status":"resolved"' }
  expect(bearsOut(e, [mcp], [], 100)).toEqual('t1')
  // Unescaping never lets an excerpt that is in the input through.
  const echo = call({ input: 'echo \\"status\\":\\"resolved\\"', result: '"status":"resolved"' })
  expect(bearsOut({ ...e, command: 'echo' }, [echo], [], 100)).toBeNull()
})

// Seen live again (S163, after the first fix loaded): an MCP result is stored inside the
// tool-result envelope, so the rows sit two or three escapes deep and one unescape was not
// enough - every quoted excerpt failed.
test('a quoted excerpt matches a result escaped at any depth', () => {
  const rows = JSON.stringify([{ status: 'resolved', ref: 'row-0042' }])
  const envelope = JSON.stringify([{ type: 'text', text: JSON.stringify({ result: rows }) }])
  const mcp = call({ tool: 'mcp__claude_ai_Supabase__execute_sql', input: 'SELECT status FROM workspace.router_inbox', result: envelope })
  const e = { source: 'call' as const, command: 'FROM workspace.router_inbox', excerpt: '"status":"resolved","ref":"row-0042"' }
  expect(bearsOut(e, [mcp], [], 100)).toEqual('t1')
})

test('the evidence window holds a long session: at least 600 calls', () => {
  expect(OBSERVED_CAP).toBeGreaterThanOrEqual(600)
})

test('the confirm tool can never be cited, and is never observed', () => {
  const self = call({ tool: CONFIRM_TOOL, input: '{"items":[]}', result: 'WITNESSED' })
  expect(observe([], self)).toEqual([])
  expect(bearsOut({ source: 'call', command: 'items', excerpt: 'WITNESSED' }, [self], [], 0)).toBeNull()
})

test('too-short excerpts and commands bear nothing out', () => {
  expect(bearsOut({ source: 'call', command: 'plugin test', excerpt: 'pass' }, [call({})], [], 100)).toBeNull()
  expect(bearsOut({ source: 'call', command: 'pl', excerpt: '175 pass' }, [call({})], [], 100)).toBeNull()
})

test('Bradley\'s own words, typed after the ask, witness what only he can see', () => {
  const heard: Heard[] = [{ text: 'the companion is there and looking cute', at: 150 }]
  expect(bearsOut({ source: 'user', excerpt: 'looking cute' }, [], heard, 100)).toEqual('user@150')
  expect(bearsOut({ source: 'user', excerpt: 'looking cute' }, [], heard, 200)).toBeNull()
  expect(bearsOut({ source: 'user', excerpt: 'looks perfect' }, [], heard, 100)).toBeNull()
})

test('findAsk matches by id, by exact text, then by a unique containment; never a dropped ask', () => {
  const asks = [ask('a1', 'Move the heads up beside the shell'), ask('a2', 'Fit the bubble'), ask('a3', 'Dock it', 1, 'dropped')]
  expect(findAsk(asks, 'a2')?.id).toEqual('a2')
  expect(findAsk(asks, 'move the heads up beside the shell')?.id).toEqual('a1')
  expect(findAsk(asks, 'heads up beside')?.id).toEqual('a1')
  expect(findAsk(asks, 'Dock it')).toBeNull()
  expect(findAsk([ask('x', 'Fit the bubble width'), ask('y', 'Fit the bubble height')], 'Fit the bubble')).toBeNull()
})

test('confirmAsks witnesses only an ask whose every citation checks out', () => {
  const asks = [ask('a1', 'Run the witness suite'), ask('a2', 'Fix the walker')]
  const items = [
    { ask: 'a1', evidence: [{ source: 'call' as const, command: 'plugin test', excerpt: '0 fail' }] },
    {
      ask: 'a2',
      evidence: [
        { source: 'call' as const, command: 'plugin test', excerpt: '0 fail' },
        { source: 'call' as const, command: 'walker', excerpt: 'walk complete' },
      ],
    },
  ]
  const { asks: out, verdicts } = confirmAsks(asks, items, [call({})], [], 999)
  expect(verdicts.map(v => v.ok)).toEqual([true, false])
  expect(out[0]?.state).toEqual('witnessed')
  expect(out[0]?.witness).toEqual({ by: 'evidence', refs: ['t1'], at: 999 })
  expect(out[1]?.state).toEqual('open')
  expect(verdicts[1]?.reason).toContain('evidence 2 did not check out')
  expect(asks[0]?.state).toEqual('open')
})

test('confirmAsks with no evidence, or no matching ask, witnesses nothing', () => {
  const asks = [ask('a1', 'Run the suite')]
  const { asks: out, verdicts } = confirmAsks(asks, [{ ask: 'a1', evidence: [] }, { ask: 'zzz', evidence: [] }], [], [], 1)
  expect(verdicts.map(v => v.ok)).toEqual([false, false])
  expect(out[0]?.state).toEqual('open')
})

test('parseItems drops malformed items and evidence rather than throwing', () => {
  expect(parseItems(null)).toEqual([])
  expect(parseItems({ items: 'x' })).toEqual([])
  const parsed = parseItems({
    items: [
      { ask: 'a1', evidence: [{ source: 'call', command: 'c', excerpt: 'e' }, { source: 'call', excerpt: 'no command' }, { source: 'x', excerpt: 'e' }] },
      { evidence: [] },
    ],
  })
  expect(parsed).toEqual([{ ask: 'a1', evidence: [{ source: 'call', command: 'c', excerpt: 'e' }] }])
})

// A field report (604_wasgenring): Bradley called an ask off ("i think we can just stick
// with the tried and tested weduploader"), and confirm could only call it done or leave it.
test('an ask Bradley called off is dropped on his own later words, never on a call', () => {
  const asks = [ask('a1', 'Add a direct upload function for guests', 100)]
  const heard: Heard[] = [{ text: 'i think we can just stick with the tried and tested weduploader', at: 150 }]
  const drop = { ask: 'a1', outcome: 'dropped' as const, evidence: [{ source: 'user' as const, excerpt: 'stick with the tried and tested weduploader' }] }
  const { asks: out, verdicts } = confirmAsks(asks, [drop], [], heard, 999)
  expect(out[0]?.state).toEqual('dropped')
  expect(out[0]?.calledOff).toEqual({ refs: ['user@150'], at: 999 })
  expect(verdicts[0]?.reason).toEqual('called off on your words')
  const report = confirmReport(verdicts, out)
  expect(report.split('\n')[0]).toEqual('DROPPED - a1: called off on your words')
  expect(report).toContain('Nothing undone.')
})

test('a drop needs Bradley\'s words typed after the ask; a call alone, or older words, refuse it', () => {
  const asks = [ask('a1', 'Add a direct upload function for guests', 200)]
  const callOnly = { ask: 'a1', outcome: 'dropped' as const, evidence: [{ source: 'call' as const, command: 'plugin test', excerpt: '0 fail' }] }
  const r1 = confirmAsks(asks, [callOnly], [call({ at: 300 })], [], 999)
  expect(r1.asks[0]?.state).toEqual('open')
  expect(r1.verdicts[0]?.reason).toContain("the user's own words")
  const older: Heard[] = [{ text: 'stick with the weduploader', at: 150 }]
  const early = { ask: 'a1', outcome: 'dropped' as const, evidence: [{ source: 'user' as const, excerpt: 'stick with the weduploader' }] }
  expect(confirmAsks(asks, [early], [], older, 999).asks[0]?.state).toEqual('open')
})

test('a witnessed ask is never dropped', () => {
  const asks = [ask('a1', 'Fix the walker', 100, 'witnessed')]
  const heard: Heard[] = [{ text: 'forget the walker, we do not need it', at: 150 }]
  const drop = { ask: 'a1', outcome: 'dropped' as const, evidence: [{ source: 'user' as const, excerpt: 'forget the walker' }] }
  const { asks: out, verdicts } = confirmAsks(asks, [drop], [], heard, 999)
  expect(out[0]?.state).toEqual('witnessed')
  expect(verdicts[0]?.reason).toEqual('already witnessed')
})

test('parseItems keeps outcome "dropped" and ignores any other outcome', () => {
  const parsed = parseItems({
    items: [
      { ask: 'a1', outcome: 'dropped', evidence: [{ source: 'user', excerpt: 'never mind that' }] },
      { ask: 'a2', outcome: 'whatever', evidence: [] },
    ],
  })
  expect(parsed).toEqual([
    { ask: 'a1', outcome: 'dropped', evidence: [{ source: 'user', excerpt: 'never mind that' }] },
    { ask: 'a2', evidence: [] },
  ])
})

test('the confirm tool describes the drop outcome and its one kind of evidence', () => {
  expect(CONFIRM_DESCRIPTION).toContain('outcome "dropped"')
  const item = (CONFIRM_SCHEMA as any).properties.items.items
  expect(item.properties.outcome.enum).toEqual(['done', 'dropped'])
})

test('observed calls are capped, and a long result keeps its head and its tail', () => {
  let log: Observed[] = []
  for (let i = 0; i < OBSERVED_CAP + 5; i++) log = observe(log, call({ toolUseId: `t${i}` }))
  expect(log.length).toEqual(OBSERVED_CAP)
  expect(log[0]?.toolUseId).toEqual('t5')
  const long = `${'a'.repeat(3000)}MIDDLE${'b'.repeat(3000)} 0 fail`
  const kept = trimResult(long)
  expect(kept.endsWith(' 0 fail')).toBe(true)
  expect(kept).not.toContain('MIDDLE')
})

test('inputText prefers the command, query or path; else the input as JSON', () => {
  expect(inputText({ command: 'git log -1' })).toEqual('git log -1')
  expect(inputText({ query: 'SELECT 1', project_id: 'p' })).toEqual('SELECT 1')
  expect(inputText({ other: 1 })).toEqual('{"other":1}')
})

test('the report names each verdict and lists what is still undone with ids', () => {
  const asks = [ask('a1', 'Run the suite', 1, 'witnessed'), ask('a2', 'Fix the walker')]
  const text = confirmReport([{ ask: 'a1', askId: 'a1', ok: true, reason: 'witnessed', refs: ['t1'] }], asks)
  expect(text).toContain('WITNESSED - a1: witnessed')
  expect(text).toContain('a2: Fix the walker')
})

// 501_blog, 2026-10-08: excerpts from the middle of a 25 KB output never
// matched, because only its head and tail are kept. The tool says so, from the constants.
test('the confirm tool tells the model which part of a long output is kept', () => {
  expect(CONFIRM_DESCRIPTION).toContain(`first ${RESULT_HEAD} and last ${RESULT_TAIL} characters`)
  expect(CONFIRM_DESCRIPTION).toContain('short read-back')
})

// Bradley, S165 (option A): confirmed on the spot, the evidence is fresh; a later bulk
// confirm (a /tackle sweep) pays to redo the read-backs.
test('the confirm tool asks to be called in the same turn as the read-back', () => {
  expect(CONFIRM_DESCRIPTION).toContain('same turn as its read-back')
})

// A field report (604_wasgenring, NEW 1): five of five free-text confirms missed on a close
// paraphrase and needed a second call with the id. The model cannot run /undone.
test('findAsk takes a close paraphrase when one live ask clearly wins, and never guesses a tie', () => {
  const asks = [
    ask('a1', 'Serve the pictures themselves, not a link'),
    ask('a2', 'Make a homelab page on in-app camera uploads'),
  ]
  expect(findAsk(asks, 'serve the pictures directly instead of a link')?.id).toEqual('a1')
  expect(findAsk(asks, 'write the homelab page about in-app camera uploads')?.id).toEqual('a2')
  const twins = [ask('b1', 'Fix the gallery view sorting'), ask('b2', 'Fix the gallery view paging')]
  expect(findAsk(twins, 'fix the gallery view')).toBeNull()
})

test('the unproved note gives each ask its id, so one confirm call can close it', () => {
  const note = unprovedNote([{ id: 'a1', text: 'Fix the walker' }])
  expect(note).toContain('a1: "Fix the walker"')
  expect(note).toContain('mcp__witness__confirm')
})

// A field report (405_85labs): eight of fifteen "Still undone" ids were last session's.
test('confirmReport lists carried asks apart from this session\'s undone, never among them', () => {
  const k: Ask = { ...ask('k', 'Complete the Stripe Connect build in this session'), source: 'carried' }
  const out = confirmReport([], [k, ask('o', 'Fix the band')])
  const lines = out.split('\n')
  const still = lines.indexOf('Still undone:')
  const carried = lines.indexOf('Carried in from the last watch (not counted in asks n/m):')
  expect(still).toEqual(0)
  expect(lines[1]).toEqual('  o: Fix the band')
  expect(carried > still).toEqual(true)
  expect(lines[carried + 1]).toEqual('  k: Complete the Stripe Connect build in this session')
  // Only carried left: nothing of this session's is undone, and the carried still show apart.
  const only = confirmReport([], [k]).split('\n')
  expect(only[0]).toEqual('Nothing undone this session.')
  expect(only).toContain('  k: Complete the Stripe Connect build in this session')
})

test('confirmReport never lists a build as undone; it says how many wait for /close', () => {
  const b: Ask = { ...ask('b', 'Rebuild 85labs to a shippable standard'), source: 'build' }
  const out = confirmReport([], [b, ask('o', 'Fix the band')])
  expect(out).toContain('o: Fix the band')
  expect(out.includes('Rebuild 85labs')).toEqual(false)
  expect(out).toContain('1 build held for /close')
})
