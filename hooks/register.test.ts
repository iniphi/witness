import { test, expect, mock } from 'claude-code/testing'

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const BARE = "UPDATE workspace.todo_mirror SET status='Done' WHERE id='x'"
const CTE = "WITH w AS (UPDATE workspace.todo_mirror SET status='Done' WHERE id='x' RETURNING *) SELECT * FROM w"
const ROWS = '<untrusted-data-1>\n[{"id":"x"}]\n</untrusted-data-1>'

/** The world beneath the plugin, answered from memory; timers held until advanced. */
function world(on: any): void {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
}

async function start($: any): Promise<void> {
  await $.session.start(START)
}

function answerAsk(on: any, label: string, seen: string[]): void {
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const q = e.questions[0]
    seen.push(q.question)
    return { result: { questions: e.questions, answers: { [q.question]: label } } }
  })
}

function answerSql(on: any, sent: string[]): void {
  on('tool.call', { tool: SQL }, (_$: any, e: any) => {
    sent.push(e.query)
    return { result: [{ type: 'text', text: ROWS }], text: ROWS }
  })
}

test('a bare UPDATE is held, and Add RETURNING sends the CTE form', async ($, on) => {
  world(on)
  const asked: string[] = []
  const sent: string[] = []
  answerAsk(on, 'Add RETURNING', asked)
  answerSql(on, sent)
  await start($)
  const r: any = await $.tool.call({ tool: SQL, project_id: 'p', query: BARE } as any)
  expect(asked.length).toEqual(1)
  expect(asked[0]).toContain('names nothing it touched')
  expect(sent).toEqual([CTE])
  expect(r.deny).toBeUndefined()
})

test('a held write that is cancelled never reaches the tool and tells the model why', async ($, on) => {
  world(on)
  const sent: string[] = []
  answerAsk(on, 'Cancel', [])
  answerSql(on, sent)
  await start($)
  const r: any = await $.tool.call({ tool: SQL, project_id: 'p', query: BARE } as any)
  expect(sent).toEqual([])
  expect(String(r.deny ?? r.text)).toContain('RETURNING')
})

// S164 live: a hold answered Add RETURNING was noted nowhere, so the print's Notes taken
// listed the let-through and cancelled answers but never this one.
/** The world, with a store that records every write, and a session that can end. */
function storeWorld(on: any, stored: Array<{ key: string; value: unknown }>): void {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$: any, e: any) => {
    stored.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's' }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
}

test('a hold answered Add RETURNING is noted, so the print can list it', async ($, on) => {
  const stored: Array<{ key: string; value: unknown }> = []
  storeWorld(on, stored)
  answerAsk(on, 'Add RETURNING', [])
  answerSql(on, [])
  await start($)
  await $.tool.call({ tool: SQL, project_id: 'p', query: BARE } as any)
  await $.session.end({ reason: 'other' } as any)
  const noted: any[] = (stored.filter((x) => x.key === 'friction:c:/work/proj').pop()?.value as any[]) ?? []
  expect(noted.map((f) => f.kind)).toEqual(['returning-added'])
  expect(noted[0].detail).toContain('UPDATE workspace.todo_mirror')
})

/** The world, with a prompt that enters as typed and every question counted. */
function promptWorld(on: any, asked: string[]): void {
  world(on)
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  answerAsk(on, 'Take the watch', asked)
}

// Ruled S164 (going global): the start-of-session watch hold is off unless turned on,
// so no project is stopped at every session start.
test('the watch hold is off by default: the first prompt is not held for the watch', async ($, on) => {
  const asked: string[] = []
  promptWorld(on, asked)
  await start($)
  await $.prompt.submit({ text: 'hello there', origin: { kind: 'composer' } } as any)
  expect(asked).toEqual([])
})

// Found S165: with the hold off, a witness-watch.py that could not be read left the watch
// pending all session, and a pending watch never lets a barnacle speak.
/** The world with one unspoken barnacle stored and every helper failing (the watch unmeasured). */
function unmeasuredWorld(on: any): any {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, {
    'barnacles:c:/work/proj': [{ key: 'tool-failure:Bash', text: 'Bash failed twice in a row', spoken: false }],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  // 1.0: the estate's scripts exist, so the ticket and watch adapters are on.
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'unreachable', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return clock
}

test('with the hold off, an unmeasured watch is still taken, so a barnacle speaks', async ($, on) => {
  const clock = unmeasuredWorld(on)
  await start($)
  await clock.advance(1)
  const first = await mountBand($)
  expect(await first.find({ type: 'Text', text: /^Watch not measured\.$/ })).toBeDefined()
  await first.unmount()
  await clock.advance(2 * 60_000)
  const later = await mountBand($)
  expect(await later.find({ type: 'Text', text: /YOU SHOULD KNOW/ })).toBeDefined()
  expect(await later.find({ type: 'Text', text: /Bash failed twice in a row/ })).toBeDefined()
  await later.unmount()
})

const DAY = Date.UTC(2026, 9, 8, 9, 0)

/** The world with Haiku answering every side pass (its usage reported) and every file write kept. */
function usageWorld(on: any, writes: Array<{ path: string; text: string }>): any {
  const clock = mock.clock(on, { now: DAY })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Home\\u' })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('fs.write', (_$: any, e: any) => {
    writes.push({ path: String(e.path), text: String(e.text) })
    return { value: undefined }
  })
  const usage = { input_tokens: 812, output_tokens: 14, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"asks": ["Fix the walker"]}', usage } }))
  return clock
}

// Bradley, S165: four witnesses in four sessions each run Haiku side passes, so their
// cost is measured, from each call's own usage, for a week before anything is added.
test('a Haiku pass records its real token counts in this session\'s usage file', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const clock = usageWorld(on, writes)
  await start($)
  await $.prompt.submit({ text: 'please fix the walker on wiki databases', origin: { kind: 'composer' } } as any)
  await clock.advance(1)
  // The engine hands fs.write a Windows path, backslashes and all.
  const files = writes.filter(w => w.path.replace(/\\/g, '/').endsWith('/witness-usage/2026-10-08/sess-1.json'))
  expect(files.length > 0).toEqual(true)
  const log = JSON.parse(files[files.length - 1]?.text ?? '{}')
  expect([log.sessionId, log.repo, log.model]).toEqual(['sess-1', 'c:/work/proj', 'haiku'])
  expect(log.rows.map((r: any) => [r.pass, r.ok, r.in, r.out])).toEqual([['extract', true, 812, 14]])
})

const TURN_USAGE = {
  input_tokens: 5_000,
  output_tokens: 300,
  cache_read_input_tokens: 90_000,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
}

const turnEnd = (answer: string, extra: Record<string, unknown> = {}) => ({
  answer,
  durationMs: 5,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  category: null,
  explanation: null,
  usage: TURN_USAGE,
  ...extra,
})

const usageRows = (writes: Array<{ path: string; text: string }>): any[] => {
  const files = writes.filter(w => w.path.replace(/\\/g, '/').includes('/witness-usage/'))
  return JSON.parse(files[files.length - 1]?.text ?? '{"rows": []}').rows
}

// Bradley, S165: the witness's own passes are only half the picture; what each turn
// cost - and what a /tackle run and its agents cost - is the denominator.
test('every turn records what it cost: main turns, a /tackle turn, and its agents', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const clock = usageWorld(on, writes)
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  await start($)
  await $.turn.complete(turnEnd('Here is the plan.') as any)
  await $.prompt.submit({ text: '/agile Tackle the undone asks the witness holds for this session:\n1. x', origin: { kind: 'composer' } } as any)
  await $.turn.complete(turnEnd('Checked the walker.', { agentId: 'a1', turnId: 't2' }) as any)
  await $.turn.complete(turnEnd('Swept the asks.', { turnId: 't3' }) as any)
  await clock.advance(1)
  const rows = usageRows(writes).filter((r: any) => r.pass !== 'extract' && r.pass !== 'match')
  expect(rows.map((r: any) => [r.pass, r.in, r.out, r.cacheRead, r.model])).toEqual([
    ['turn', 5000, 300, 90000, 'claude-opus-5-5'],
    ['agent', 5000, 300, 90000, 'claude-opus-5-5'],
    ['tackle', 5000, 300, 90000, 'claude-opus-5-5'],
  ])
})

/** usageWorld, with Haiku answering the extract pass with one ask and the match pass with it. */
function nudgeWorld(on: any, writes: Array<{ path: string; text: string }>, contexts: string[][]): any {
  const clock = mock.clock(on, { now: DAY })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('prompt.submit', (_$: any, e: any) => {
    contexts.push([...(e.context ?? [])])
    return { text: e.text }
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('fs.write', (_$: any, e: any) => {
    writes.push({ path: String(e.path), text: String(e.text) })
    return { value: undefined }
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', (_$: any, e: any) => {
    const text = String(e.prompt).includes('compare a numbered list') ? '{"done": [1]}' : '{"asks": ["Fix the walker"]}'
    return { value: { isAnswered: true, text, usage } }
  })
  return clock
}

// Bradley, S165 (option B): an ask Claude called done without a read-back is put to
// Claude once, on the next prompt, so it is proved while the evidence is fresh rather
// than re-verified later by a /tackle sweep.
test('an ask claimed but not proved is put to Claude once, on the next prompt', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const contexts: string[][] = []
  const clock = nudgeWorld(on, writes, contexts)
  await start($)
  await $.prompt.submit({ text: 'please fix the walker on wiki databases', origin: { kind: 'composer' } } as any)
  await clock.advance(1)
  await $.turn.complete(turnEnd('The walker is fixed.') as any)
  await clock.advance(1)
  await $.prompt.submit({ text: 'thanks, what next', origin: { kind: 'composer' } } as any)
  await $.prompt.submit({ text: 'and after that', origin: { kind: 'composer' } } as any)
  expect(contexts[0]).toEqual([])
  expect(contexts[1]?.length).toEqual(1)
  expect(contexts[1]?.[0]).toContain('"Fix the walker"')
  expect(contexts[1]?.[0]).toContain('mcp__witness__confirm')
  expect(contexts[2]).toEqual([])
})

// A field report (604_wasgenring): "that looks great, greenlight" commissioned a Photos
// tab Claude had proposed, but the side pass saw only the greenlight and minted nothing.
test('a greenlight is read beside the end of the answer it approves', async ($, on) => {
  const prompts: string[] = []
  const clock = mock.clock(on, { now: DAY })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('fs.write', () => ({ value: undefined }))
  on('model.complete', (_$: any, e: any) => {
    prompts.push(String(e.prompt))
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { value: { isAnswered: true, text: '{"asks": [], "builds": []}', usage } }
  })
  await start($)
  await $.turn.complete(turnEnd('Assessment done. Proposal: add a Photos tab so the guests\' photos sit apart from the information.') as any)
  await clock.advance(1)
  await $.prompt.submit({ text: 'that looks great, greenlight', origin: { kind: 'composer' } } as any)
  await clock.advance(1)
  const extract = prompts.filter(p => p.includes('list the asks in it'))
  expect(extract.length).toEqual(1)
  expect(extract[0]).toContain('Proposal: add a Photos tab')
  expect(extract[0]!.indexOf('Proposal: add a Photos tab') < extract[0]!.indexOf('that looks great, greenlight')).toEqual(true)
})

/** A session with an open log on disk; captures writes and the prompts the witness submits. */
function wrapWorld(
  on: any,
  writes: Array<{ path: string; text: string }>,
  submitted: string[],
  interactive = true,
  o: { hasLog?: boolean; contexts?: string[][]; carry?: unknown[]; log?: string; beneath?: ($: any, e: any) => any } = {},
): any {
  const clock = mock.clock(on, { now: DAY })
  mock.store(on, {
    'carry:c:/work/proj': o.carry ?? [{ id: 'a1', text: 'Add the photos pane', source: 'ask', state: 'open', claimId: null, at: 1 }],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', ($: any, e: any) => (o.beneath ? o.beneath($, e) : { type: 'engine', ref: 0 }))
  on('fs.exists', () => ({ value: o.hasLog !== false }))
  on('fs.list', () => ({ value: [{ name: '2026-10-08-1036.md', kind: 'file', mtimeMs: DAY }] }))
  on('fs.read', () => ({ value: o.log ?? '# Session: 2026-10-08 10:36\n\n## Goals\n- [ ] Add the photos pane\n' }))
  on('fs.write', (_$: any, e: any) => {
    writes.push({ path: String(e.path), text: String(e.text) })
    return { value: undefined }
  })
  on('prompt.submit', (_$: any, e: any) => {
    if (e.origin?.kind === 'plugin') submitted.push(String(e.text))
    o.contexts?.push([...(e.context ?? [])])
    return { text: e.text }
  })
  return { clock, start: { ...START, isInteractive: interactive } }
}

// Bradley, 2026-10-08: /wrap printed the watch, but the main session never read it.
test('/wrap writes the print, then hands it to the main session as a turn of its own', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const submitted: string[] = []
  const w = wrapWorld(on, writes, submitted)
  await $.session.start(w.start)
  await w.clock.advance(1)
  const r: any = await $.command.run({ command: 'wrap', args: '' } as any)
  await w.clock.advance(1)
  expect(writes.some(x => x.path.endsWith('2026-10-08-1036.md') && x.text.includes('## Witness print'))).toEqual(true)
  expect(String(r.text)).toContain('Witness print written to')
  expect(submitted.length).toEqual(1)
  expect(submitted[0]!.split('\n')[0]).toContain('/wrap')
  expect(submitted[0]).toContain('## Witness print')
  expect(submitted[0]).toContain('Add the photos pane')
})

// A field report (pm): two column-name errors inside one blind verifier of a Workflow
// were printed as the session's own "failed twice in a row".
test('a sub-agent\'s failures are not the session\'s friction; the main session\'s still are', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const w = wrapWorld(on, writes, [])
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' }, text: 'column "to_agent" does not exist', isError: true }))
  await $.session.start(w.start)
  await $.tool.call({ tool: 'Bash', command: 'psql -c select', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'psql -c select', agentId: 'ag2' } as any)
  await $.command.run({ command: 'wrap', args: '' } as any)
  const print = () => writes.filter(x => x.text.includes('## Witness print')).pop()?.text ?? ''
  expect(print().includes('failed twice in a row')).toEqual(false)
  await $.tool.call({ tool: 'Bash', command: 'psql -c select' } as any)
  await $.tool.call({ tool: 'Bash', command: 'psql -c select' } as any)
  await $.command.run({ command: 'wrap', args: '' } as any)
  expect(print()).toContain('failed twice in a row')
})

// A field report (405_85labs): a /tackle after /close offered the carried asks the close
// triage had just dismissed with evidence.
test('/tackle after a close leaves out what the triage dismissed or made a to-do', async ($, on) => {
  mock.clock(on, { now: DAY })
  const carry = (id: string, text: string) => ({ id, text, source: 'ask', state: 'open', claimId: null, at: 1 })
  mock.store(on, {
    'carry:c:/work/proj': [
      carry('k1', 'Plan a separate full database for 85 labs'),
      carry('k2', 'Complete the Stripe Connect build in this session'),
      carry('k3', 'Do the recording pass'),
    ],
  })
  const closed = [
    '# Session',
    '## Witness triage',
    '- dismissed: Plan a separate full database for 85 labs (carried) - already on the board as Phase 0',
    '- to-do: Complete the Stripe Connect build in this session -> https://www.notion.example/abc',
    '## Session Closed',
  ].join('\n')
  const filled: string[] = []
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: '2026-10-08-1054.md', kind: 'file', mtimeMs: DAY }] }))
  on('fs.read', () => ({ value: closed }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await start($)
  await $.command.run({ command: 'tackle', args: '' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]).toContain('Do the recording pass')
  expect(filled[0]!.includes('Plan a separate full database')).toEqual(false)
  expect(filled[0]!.includes('Stripe Connect')).toEqual(false)
})

// A field report (604_wasgenring, NEW 2): a project that keeps no session log got no print
// at /close, so Step 4b had nothing to triage.
test('/close with no session log hands the print to the close as context instead', async ($, on) => {
  const contexts: string[][] = []
  const w = wrapWorld(on, [], [], true, { hasLog: false, contexts })
  await $.session.start(w.start)
  await $.prompt.submit({ text: '/close', origin: { kind: 'composer' } } as any)
  const close = contexts[contexts.length - 1] ?? []
  expect(close.length).toEqual(1)
  expect(close[0]).toContain('no session log')
  expect(close[0]).toContain('## Witness print')
  expect(close[0]).toContain('Add the photos pane')
})

// A field report (205_snf): no print at /close. The session ran the witness loaded at its
// start (0.5.1), not 0.9.0; these pin that 0.9.0 attaches the note even with nothing undone.
test('/close with no session log and nothing undone still hands the print to the close', async ($, on) => {
  const contexts: string[][] = []
  const w = wrapWorld(on, [], [], true, { hasLog: false, contexts, carry: [] })
  await $.session.start(w.start)
  await $.prompt.submit({ text: '/close', origin: { kind: 'composer' } } as any)
  const close = contexts[contexts.length - 1] ?? []
  expect(close.length).toEqual(1)
  expect(close[0]).toContain('witness: this project keeps no session log')
  expect(close[0]).toContain('Asks: 0 of 0 witnessed, 0 pale, 0 open.')
})

test('/close where the only session log is already closed hands the print over, and writes no log', async ($, on) => {
  const contexts: string[][] = []
  const writes: Array<{ path: string; text: string }> = []
  const log = '# Session: 2026-10-08 10:36\n\n## Goals\n- [x] Old goal\n\n## Session Closed\n'
  const w = wrapWorld(on, writes, [], true, { contexts, carry: [], log })
  await $.session.start(w.start)
  await $.prompt.submit({ text: '/close --light', origin: { kind: 'composer' } } as any)
  const close = contexts[contexts.length - 1] ?? []
  expect(close.length).toEqual(1)
  expect(close[0]).toContain('## Witness print')
  expect(writes.some(x => x.text.includes('## Witness print'))).toEqual(false)
})

// To-do 3f23...c538: a Heads up from beneath was drawn in the bubble but never noted.
test('a note from beneath is recorded once in the print\'s Notes taken, under HEADS UP', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const beneath = ($: any, e: any) => $.ui.resolve(e).Text({ children: 'Heads up: try /fast' })
  const w = wrapWorld(on, writes, [], true, { beneath })
  await $.session.start(w.start)
  for (const _ of [1, 2]) {
    const ui = await mountBand($, 80)
    await ui.unmount()
    await w.clock.advance(1)
  }
  await $.command.run({ command: 'wrap', args: '' } as any)
  const print = writes.find(x => x.text.includes('## Witness print'))?.text ?? ''
  expect(print.split('- said (HEADS UP): Heads up: try /fast').length - 1).toEqual(1)
})

test('/close writes the print but submits nothing: the close skill reads the log itself', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const submitted: string[] = []
  const w = wrapWorld(on, writes, submitted)
  await $.session.start(w.start)
  await $.prompt.submit({ text: '/close', origin: { kind: 'composer' } } as any)
  await w.clock.advance(1)
  expect(writes.some(x => x.text.includes('## Witness print'))).toEqual(true)
  expect(submitted).toEqual([])
})

/** The world where witness-watch.py reads an empty board at start and one row at the next poll. */
function boardWorld(on: any, toasts: string[]): any {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  // 1.0: the estate's scripts exist, so the ticket and watch adapters are on.
  on('fs.exists', () => ({ value: true }))
  const row = { id: 'r1', agent_from: '501_blog', subject: 'witness: confirm sees only the tail', created_at: 'now' }
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    const watch = argv.some(a => a.endsWith('witness-watch.py'))
    const stdout = !watch ? '' : JSON.stringify(argv.includes('--rows') ? { inbox: [row] } : { project: 'p', inbox: [] })
    return { value: { exitCode: watch ? 0 : 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return clock
}

// Seen S165: "501_blog: ..." in an Overseer session read as 501_blog's own board leaking
// in. It is a row 501_blog SENT to this board; the bubble now says so.
test('a board row landing names its sender as from, never as the board it sits on', async ($, on) => {
  const toasts: string[] = []
  const clock = boardWorld(on, toasts)
  await start($)
  await clock.advance(1)
  await clock.advance(5 * 60_000)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^from 501_blog: witness: confirm sees only the tail$/ })).toBeDefined()
  expect(toasts).toEqual(['Board: 1 new, from 501_blog: witness: confirm sees only the tail'])
  await ui.unmount()
})

test('with the watch hold turned on, the first prompt asks to take the watch', { options: { watchHold: true } }, async ($, on) => {
  const asked: string[] = []
  promptWorld(on, asked)
  await start($)
  await $.prompt.submit({ text: 'hello there', origin: { kind: 'composer' } } as any)
  expect(asked).toEqual(['Take the watch?'])
})

test('let through once passes the bare write unchanged', async ($, on) => {
  world(on)
  const sent: string[] = []
  answerAsk(on, 'Let through once', [])
  answerSql(on, sent)
  await start($)
  await $.tool.call({ tool: SQL, project_id: 'p', query: BARE } as any)
  expect(sent).toEqual([BARE])
})

// That the RETURNING rows witness the write is the claim ledger's to prove
// (classify.test.ts, witness.test.ts): the test kit's $ carries no state noun.
test('an UPDATE with RETURNING passes with no hold', async ($, on) => {
  world(on)
  const asked: string[] = []
  const sent: string[] = []
  answerAsk(on, 'Cancel', asked)
  answerSql(on, sent)
  await start($)
  const query = `${BARE} RETURNING id`
  await $.tool.call({ tool: SQL, project_id: 'p', query } as any)
  expect(asked).toEqual([])
  expect(sent).toEqual([query])
})

test('a SELECT-led writer function is never held', async ($, on) => {
  world(on)
  const asked: string[] = []
  const sent: string[] = []
  answerAsk(on, 'Cancel', asked)
  answerSql(on, sent)
  await start($)
  await $.tool.call({ tool: SQL, project_id: 'p', query: "SELECT workspace.close_todo('abc', 'done')" } as any)
  expect(asked).toEqual([])
  expect(sent.length).toEqual(1)
})

// 0.3.0 draws the ticket itself (Bradley, S165). An estate-status mod still enabled
// beside it must not draw a second ticket line; what stood beneath its line still shows.
test('a ticket band still standing beneath is dropped, and a note beneath it is voiced', async ($, on) => {
  world(on)
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      key: 'estate-band',
      flexDirection: 'column',
      children: [Text({ children: 'ticket line' }), Text({ children: 'Heads up from beneath' })],
    })
  })
  await start($)
  const ui = await mountBand($, 80)
  expect(await ui.findAll({ type: 'Text', text: /ticket line/ })).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Heads up from beneath$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /asks 0\/0/ })).toBeDefined()
  await ui.unmount()
})

const ESTATE_HELPER_NAME = 'estate-status.py'
const estateJson = (metered: string): string =>
  JSON.stringify({ board_id: 'overseer', inbox_open: 2, code_todos_open: 7, metered, session_log: '2026-10-08-0010' })

/** The world, with estate-status.py answering `estate` (null: it fails) and every other helper failing. */
function ticketWorld(on: any, estate: string | null, argvs: string[][] = []): any {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  // 1.0: the estate's scripts exist, so the ticket and watch adapters are on.
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    argvs.push(argv)
    const ok = estate !== null && argv.some(a => a.endsWith(ESTATE_HELPER_NAME))
    const value = { exitCode: ok ? 0 : 1, stdout: ok ? estate : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    return { value }
  })
  return clock
}

async function mountBand($: any, bodyColumns = 100): Promise<any> {
  return $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns },
  } as any)
}

// The notice queue (Bradley, 2026-10-09): two notices in one turn are both kept; the
// bubble shows one, `0: Dismiss <1/2>` at its foot, and the Dismiss advances to the next.
test('two notices queue: one shown with <1/2>, Dismiss (key 0) advances to <2/2>', async ($, on) => {
  const clock = ticketWorld(on, null)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  await start($)
  await clock.advance(1)
  await $.prompt.submit({ text: '/close', origin: { kind: 'composer' } } as any)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^Watch not measured\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /<1\/2>/ })).toBeDefined()
  const button = await ui.find({ type: 'Button', key: 'witness-dismiss' } as any)
  expect([button?.props.hotkey, button?.props.label]).toEqual(['0', 'Dismiss'])
  await $.ui.press({ plugin: 'witness', key: 'witness-dismiss' } as any)
  await ui.unmount()
  const after = await mountBand($)
  expect(await after.findAll({ type: 'Text', text: /^Watch not measured\.$/ })).toEqual([])
  expect(await after.find({ type: 'Text', text: /<2\/2>/ })).toBeDefined()
  await after.unmount()
})

// Bradley's one line (S162), now drawn by the witness alone: the estate ticket cut to
// inbox and Code to-dos, the companion's counts appended, the creature to the right.
test('the one line opens with the estate ticket, then the counts; push and log gone', async ($, on) => {
  const clock = ticketWorld(on, estateJson('UNMETERED'))
  await start($)
  await clock.advance(1)
  const ui = await mountBand($)
  const line = await ui.find({ type: 'Text', text: /^\u258c overseer: inbox 2 \u00b7 Code to-dos 7 \u00b7 asks 0\/0/ })
  expect(line).toBeDefined()
  expect(line?.props.wrap).toEqual('truncate-end')
  expect(await ui.findAll({ type: 'Text', text: /push|2026-10-08-0010/ })).toEqual([])
  const tag = await ui.find({ type: 'Text', text: /^overseer$/ })
  expect([tag?.props.color, tag?.props.bold]).toEqual(['#D44C47', true])
  const inbox = await ui.find({ type: 'Text', text: /^2$/ })
  expect(inbox?.props.color).toEqual('warning')
  await ui.unmount()
})

// Bradley, S165: "push METERED" took room on the line, so a metered repo colours the
// nautilus's eyes instead. Inbox 0 here, so the eye is the only warning-coloured text.
const quietJson = (metered: string): string =>
  JSON.stringify({ board_id: 'overseer', inbox_open: 0, code_todos_open: 7, metered })

const warned = async (ui: any): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' })).filter((t: any) => t.props.color === 'warning').map((t: any) => t.text)

test('a METERED repo colours the eyes, not the line', async ($, on) => {
  const clock = ticketWorld(on, quietJson('METERED'))
  await start($)
  await clock.advance(1)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Code to-dos 7 \u00b7 asks 0\/0/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /push|METERED/ })).toEqual([])
  expect(await warned(ui)).toEqual(['o'])
  await ui.unmount()
})

test('an UNMETERED repo leaves the eyes in the creature\'s own colour', async ($, on) => {
  const clock = ticketWorld(on, quietJson('UNMETERED'))
  await start($)
  await clock.advance(1)
  const ui = await mountBand($)
  expect(await warned(ui)).toEqual([])
  await ui.unmount()
})

test('the ticket is read from estate-status.py for this project, and again every 10 minutes', async ($, on) => {
  const argvs: string[][] = []
  const clock = ticketWorld(on, estateJson('UNMETERED'), argvs)
  await start($)
  await clock.advance(1)
  const estate = () => argvs.filter(a => a.some(x => x.endsWith(ESTATE_HELPER_NAME)))
  expect(estate().length).toEqual(1)
  expect(estate()[0]?.slice(-3)).toEqual(['--json', '--project-dir', 'C:/work/proj'])
  await clock.advance(10 * 60_000)
  expect(estate().length).toEqual(2)
})

test('a ticket that cannot be read shows as estate ?, never as zeros, and the counts stay', async ($, on) => {
  const clock = ticketWorld(on, null)
  await start($)
  await clock.advance(1)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^estate: \? \u00b7 asks 0\/0/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /inbox 0|to-dos 0/ })).toEqual([])
  await ui.unmount()
})

/** A session whose store carries one undone ask, and a prompt box holding `draft`. */
function tackleWorld(on: any, text: string, draft: string, filled: string[]): void {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on, {
    'carry:c:/work/proj': [{ id: 'a1', text, source: 'ask', state: 'open', claimId: null, at: 1 }],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  // 1.0: the estate's scripts exist, so the ticket and watch adapters are on.
  on('fs.exists', () => ({ value: true }))
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  // prompt.fill is an event: its answer is PromptFillResult itself, not a { value }.
  on('prompt.fill', (_$: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true }
  })
}

test('/tackle puts an /agile run over the undone asks in an empty prompt box', async ($, on) => {
  const filled: string[] = []
  tackleWorld(on, 'Move the heads up beside the shell', '', filled)
  await start($)
  const r: any = await $.command.run({ command: 'tackle', args: '' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]).toContain('/agile Tackle the undone asks')
  expect(filled[0]).toContain('1. Move the heads up beside the shell')
  expect(String(r.text)).toContain('in your prompt box')
})

test('/tackle never writes over a draft in the prompt box', async ($, on) => {
  const filled: string[] = []
  tackleWorld(on, 'Do a thing', 'half a thought', filled)
  await start($)
  const r: any = await $.command.run({ command: 'tackle', args: '' } as any)
  expect(filled).toEqual([])
  expect(String(r.text)).toContain('draft')
})

// Seen live 2026-10-08: a fresh session opened on `asks 0/10` before Bradley typed a word.
// The store held S165's one open ask and nine goals its own log had ticked.
test('a fresh session counts no asks: the open one carried in shows apart, the ticked goals stay behind', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const goal = (id: string) => ({ id, text: `goal ${id}`, source: 'goal', state: 'claimed', claimId: null, at: 1 })
  mock.store(on, {
    'carry:c:/work/proj': [
      { id: 'a1', text: 'Make the usage report show dollar cost', source: 'ask', state: 'open', claimId: null, at: 1 },
      goal('g1'),
      goal('g2'),
    ],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /asks 0\/0 \u00b7 carried 1/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /asks 0\/3|asks 0\/1/ })).toEqual([])
  await ui.unmount()
})

test('a multi-session build in a prompt is held apart: builds 1 on the band, never in asks n/m', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const usage = { input_tokens: 700, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const text = '{"asks": ["Complete the Stripe Connect build"], "builds": ["Rebuild 85labs to a shippable standard"]}'
  on('model.complete', () => ({ value: { isAnswered: true, text, usage } }))
  await start($)
  await $.prompt.submit({
    text: 'complete the stripe connect build today, then over the next few days rebuild 85labs to ship',
    origin: { kind: 'composer' },
  } as any)
  await clock.advance(1)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /asks 0\/1 · builds 1/ })).toBeDefined()
  await ui.unmount()
})

/** A session with one undone ask carried in, and a Bash tool beneath that prints `output`. */
function confirmWorld(on: any, output: string): void {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on, {
    'carry:c:/work/proj': [{ id: 'a1', text: 'Run the witness suite', source: 'ask', state: 'open', claimId: null, at: 1 }],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: output }, text: output }))
}

test('the confirm tool witnesses an ask on a read-back the mod itself observed', async ($, on) => {
  confirmWorld(on, ' 175 pass\n 0 fail\nRan 175 tests across 13 files.')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test mods/witness' } as any)
  const r: any = await $.tool.call({
    tool: 'mcp__witness__confirm',
    items: [{ ask: 'Run the witness suite', evidence: [{ source: 'call', command: 'plugin test mods/witness', excerpt: '175 pass 0 fail' }] }],
  } as any)
  expect(String(r.result)).toContain('WITNESSED - Run the witness suite: witnessed')
  expect(String(r.result)).toContain('Nothing undone.')
})

test('the confirm tool refuses evidence the mod never observed', async ($, on) => {
  confirmWorld(on, ' 3 fail')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test mods/witness' } as any)
  const r: any = await $.tool.call({
    tool: 'mcp__witness__confirm',
    items: [{ ask: 'Run the witness suite', evidence: [{ source: 'call', command: 'plugin test', excerpt: '175 pass 0 fail' }] }],
  } as any)
  // A carried ask gets a fresh id each session, so the report lists the live one.
  expect(String(r.result)).toContain('NOT WITNESSED - Run the witness suite: evidence 1 did not check out')
  // a carried ask is listed apart, never as this session's undone.
  expect(String(r.result)).toMatch(/Carried in from the last watch \(not counted in asks n\/m\):\n {2}\S+: Run the witness suite/)
})

// Seen live (S162), seven times: with nothing drawing beneath, next(e) is the engine's
// own node, and an engine node under a Box with a width is refused - the whole band
// (Phi and the ticket) went blank whenever no Heads up was showing.
test('with only the engine beneath, the band still draws (no engine node under a width)', async ($, on) => {
  world(on)
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await start($)
  const ui = await $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 80 },
  } as any)
  expect(await ui.find({ type: 'Text', text: /asks 0\/0/ })).toBeDefined()
  await ui.unmount()
})

test('the band draws the compact companion under what stands beneath it', async ($, on) => {
  world(on)
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'ticket' }))
  await start($)
  const ui = await $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 11, bodyColumns: 100 },
  } as any)
  expect(await ui.find({ type: 'Text', text: /^ticket$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /asks 0\/0/ })).toBeDefined()
  await ui.unmount()
})

// 1.0 (the core/estate split, ruled 2026-10-09): a Claude Code with no estate at all.
/** No estate script exists anywhere; every helper call and prompt-box fill is recorded. */
function noEstateWorld(on: any, argvs: string[][], filled: string[], exists: (path: string) => boolean = () => false): any {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, {
    'carry:c:/work/proj': [{ id: 'a1', text: 'Fix the walker', source: 'ask', state: 'open', claimId: null, at: 1 }],
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.exists', (_$: any, e: any) => ({ value: exists(String(e.path)) }))
  on('process.run', (_$: any, e: any) => {
    argvs.push(e.argv)
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return clock
}

const estateRuns = (argvs: string[][]) => argvs.filter(a => a.some(x => /estate-status\.py|witness-watch\.py/.test(x)))

test('with no estate scripts: no ticket, no watch, no poll, no estate: ?, and no crash', async ($, on) => {
  const argvs: string[][] = []
  const clock = noEstateWorld(on, argvs, [])
  await start($)
  await clock.advance(1)
  await clock.advance(10 * 60_000)
  expect(estateRuns(argvs)).toEqual([])
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /asks \d+\/\d+/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /estate/ })).toEqual([])
  expect(await ui.findAll({ type: 'Text', text: /Watch not measured/ })).toEqual([])
  await ui.unmount()
})

test('with no estate scripts /tackle names no estate skill, in the prompt or the reply', async ($, on) => {
  const filled: string[] = []
  noEstateWorld(on, [], filled)
  await start($)
  const r: any = await $.command.run({ command: 'tackle', args: '' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]?.startsWith('Tackle the undone asks the witness holds')).toBe(true)
  expect(filled[0]).not.toContain('/agile')
  expect(filled[0]).toContain('1. Fix the walker')
  expect(String(r.text)).toEqual('A run over 1 undone ask is in your prompt box: read it, then press Enter.')
})

test('a configured ticket script is run from the session folder, and only it', { options: { ticketScript: 'tools/ticket.py' } }, async ($, on) => {
  const argvs: string[][] = []
  const clock = noEstateWorld(on, argvs, [], path => path.replace(/\\/g, '/') === 'C:/work/proj/tools/ticket.py')
  await start($)
  await clock.advance(1)
  expect(argvs.map(a => a[1])).toEqual(['C:/work/proj/tools/ticket.py'])
  expect(estateRuns(argvs)).toEqual([])
})
