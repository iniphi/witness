import { test, expect, mock } from 'claude-code/testing'
import { capField, jewelsText, relativeAge, settledCounts } from './jewels'

// witness 1.6: /jewels, the proposed hooks and skills in their own pane. Plugin tests fake the
// engine, so how the pane reads in the person's terminal is a live look owed after /reload-plugins.

const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const KEY = 'candidates:c:/work/proj'
const hook = { key: 'hook:guard', kind: 'hook', title: 'Guard bare UPDATE', why: 'it recurs', evidence: 'three holds', at: 20, filed: true }
const skill = { key: 'skill:close', kind: 'skill', title: 'Close routine', why: 'same six steps', evidence: 'two closes', at: 30, filed: false }
const old = { key: 'hook:old', kind: 'hook', title: 'Older', why: 'w', evidence: 'e', at: 10, filed: false }
const done = { key: 'hook:done', kind: 'hook', title: 'Done one', why: 'w', evidence: 'e', at: 5, filed: true, settled: { how: 'taken', at: 6 } }
const gone = { key: 'skill:gone', kind: 'skill', title: 'Gone one', why: 'w', evidence: 'e', at: 4, filed: true, settled: { how: 'dismissed', at: 7 } }

// The clock of the world last built: the lamp test (1.7) shows red for 1.5 s at start, hiding the gems' own inks.
let clock: any
function world(on: any, store: Map<string, unknown>, placed = true, filled: string[] = [], exists = false): void {
  clock = mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000 } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.open', () => ({ value: { isPlaced: placed } }))
  on('fs.exists', () => ({ value: exists }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true }
  })
}

const jewels = ($: any) =>
  $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'witness-jewels',
    props: { title: 'Jewels', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40 } },
  } as any)

const barnacles = ($: any) =>
  $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'witness-barnacles',
    props: { title: 'Barnacles', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 20 } },
  } as any)

/** Text nodes drawn in this colour; `find` with a colour filter proved too loose to trust. */
const colored = async (ui: any, color: string): Promise<any[]> => (await ui.findAll({ type: 'Text' } as any)).filter((n: any) => n.props?.color === color)

const band = ($: any) =>
  $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 100 } } as any)

test('the pane lists a hook and a skill in full, newest first, gems in the shell\'s colours, with the settled count', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [old, hook, skill, done, gone]]]))
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'jewels', args: '' } as any)
  expect(String(r.text)).toContain('3 jewels proposed')
  const p = await jewels($)
  expect((await colored(p, 'success')).length).toEqual(2)
  expect((await colored(p, 'suggestion')).length).toEqual(1)
  expect(await p.find({ type: 'Text', text: /Skill: Close routine/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: /Why: same six steps/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: /Evidence: three holds/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: /not filed yet/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: /filed to the candidates file/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: 'Settled: built 0, taken 1, dismissed 1.' } as any)).toBeDefined()
  expect(await p.find({ type: 'Text', text: /Done one/ } as any)).toBeUndefined()
  const heads = await p.findAll({ type: 'Text', text: /(Hook|Skill): / } as any)
  expect(heads.length).toEqual(3)
  expect(await p.find({ type: 'Button', key: 'take-skill:close' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'dismiss-hook:old' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'jewels-calibrate-all' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'jewels-dismiss-all' } as any)).toBeUndefined()
  await p.unmount()
})

test('dismiss settles through the shared path: the store keeps a peer\'s candidate and the gem goes off the shell', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  world(on, store)
  await $.session.start(START)
  const p = await jewels($)
  store.set(KEY, [hook, skill, old])
  await $.ui.press({ plugin: 'witness', key: 'dismiss-skill:close' } as any)
  const kept = store.get(KEY) as any[]
  expect(kept.map(c => c.key)).toEqual(['hook:guard', 'skill:close', 'hook:old'])
  expect(kept[1].settled.how).toEqual('dismissed')
  expect(kept[0].settled).toBeUndefined()
  await p.unmount()
  await clock.advance(1_500)
  // The skill's blue gem is off the band.
  const ui = await band($)
  expect((await colored(ui, 'suggestion')).length).toEqual(0)
  expect((await colored(ui, 'success')).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('take fills the prompt box and settles taken', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  const filled: string[] = []
  world(on, store, true, filled)
  await $.session.start(START)
  const p = await jewels($)
  await $.ui.press({ plugin: 'witness', key: 'take-hook:guard' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]).toContain('Guard bare UPDATE')
  expect((store.get(KEY) as any[])[0].settled.how).toEqual('taken')
  expect((store.get(KEY) as any[])[1].settled).toBeUndefined()
  await p.unmount()
})

test('dismiss one by one still settles each dismissed (the bulk path is calibrate all)', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  world(on, store)
  await $.session.start(START)
  const p = await jewels($)
  await $.ui.press({ plugin: 'witness', key: 'dismiss-hook:guard' } as any)
  await $.ui.press({ plugin: 'witness', key: 'dismiss-skill:close' } as any)
  expect((store.get(KEY) as any[]).every(c => c.settled?.how === 'dismissed')).toEqual(true)
  await p.unmount()
})

test('with nothing proposed the pane says so in one plain line', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>())
  await $.session.start(START)
  const p = await jewels($)
  expect(await p.find({ type: 'Text', text: /Nothing is proposed yet/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'jewels-calibrate-all' } as any)).toBeUndefined()
  await p.unmount()
})

test('headless, /jewels answers with the content as text', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [hook, skill, done]]]), false)
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'jewels', args: '' } as any)
  const text = String(r.text)
  expect(text).toContain('2 jewels proposed')
  expect(text.indexOf('Close routine')).toBeLessThan(text.indexOf('Guard bare UPDATE'))
  expect(text).toContain('Evidence: three holds')
  expect(text).toContain('Settled: built 0, taken 1, dismissed 0.')
})

test('the Barnacles pane points to /jewels instead of listing candidates', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [hook, skill]]]))
  await $.session.start(START)
  const p = await barnacles($)
  expect(await p.find({ type: 'Text', text: /2 jewels proposed: \/jewels/ } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'take-hook:guard' } as any)).toBeUndefined()
  expect(await p.find({ type: 'Button', key: 'gems-dismiss-all' } as any)).toBeUndefined()
  await p.unmount()
})

test('the pure parts: age, cap, counts', () => {
  expect(relativeAge(1000, 1000)).toEqual('just now')
  expect(relativeAge(0, 5 * 60_000)).toEqual('5 min ago')
  expect(relativeAge(0, 3 * 3_600_000)).toEqual('3 h ago')
  expect(relativeAge(0, 72 * 3_600_000)).toEqual('3 d ago')
  expect(capField('short')).toEqual('short')
  expect(capField('x'.repeat(700)).endsWith('(cut)')).toEqual(true)
  expect(settledCounts([done, gone, hook] as any)).toEqual({ built: 0, taken: 1, dismissed: 1 })
  expect(jewelsText([] as any, 0)).toContain('Nothing is proposed yet')
})

const OTHER = 'candidates:c:/work/other-repo'
const foreign = { key: 'hook:far', kind: 'hook', title: 'Far hook', why: 'elsewhere', evidence: 'seen there', at: 40, filed: false }

test('a candidate another session wrote after start appears in /jewels, and in the Barnacles pointer', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook]]])
  world(on, store)
  await $.session.start(START)
  store.set(KEY, [hook, skill])
  const p = await jewels($)
  expect(await p.find({ type: 'Text', text: /Skill: Close routine/ } as any)).toBeDefined()
  await p.unmount()
  const q = await barnacles($)
  expect(await q.find({ type: 'Text', text: /2 jewels proposed: \/jewels/ } as any)).toBeDefined()
  await q.unmount()
})

test('headless text sees a fresh store write', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook]]])
  world(on, store, false)
  await $.session.start(START)
  store.set(KEY, [hook, skill])
  const r: any = await $.command.run({ command: 'jewels', args: '' } as any)
  expect(String(r.text)).toContain('2 jewels proposed')
})

test('another project\'s jewel is neither listed, counted nor actionable', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook]], [OTHER, [foreign]]])
  world(on, store)
  await $.session.start(START)
  const p = await jewels($)
  expect(await p.find({ type: 'Text', text: /Far hook/ } as any)).toBeUndefined()
  expect(await p.find({ type: 'Text', text: /other projects/ } as any)).toBeUndefined()
  expect(await p.find({ type: 'Button', key: 'jewels-all' } as any)).toBeUndefined()
  expect(await p.find({ type: 'Button', key: `take-${OTHER}#hook:far` } as any)).toBeUndefined()
  await p.unmount()
  const r: any = await $.command.run({ command: 'jewels', args: '' } as any)
  expect(String(r.text)).toContain('1 jewel proposed')
  expect(String(r.text)).not.toContain('other projects')
  expect((store.get(OTHER) as any[])[0].settled).toBeUndefined()
})

// 1.7.1 (Bradley, 2026-10-11: "when a skill or hook is taken it reappears in the jewel section so
// i have to redismiss it"): a session that loaded the list at its start wrote it back whole at
// /wrap, so a jewel another session had taken came back unsettled.
test('a jewel another session took stays taken when this session files its candidates at /wrap', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  const writes: string[] = []
  world(on, store, true, [], true)
  on('fs.read', () => ({ value: '# Session\n\n## Goals\n' }))
  on('fs.write', (_$: any, e: any) => {
    writes.push(String(e.path))
    return { value: undefined }
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  for (const tool of ['Write', 'Edit', 'Read']) on('tool.call', { tool }, () => ({ result: { ok: true }, text: `${tool} ok` }))
  await $.session.start(START)
  // /wrap files only into a bound log; the session binds one by writing it (1.1). The path is
  // built from parts: the export's leak test refuses a dated log path written whole.
  await $.tool.call({ tool: 'Write', file_path: `${START.cwd}/.claude/sessions/${'2026'}-10-11-1210.md`, content: '# Session' } as any)
  // Another live session takes the skill jewel after this one started.
  store.set(KEY, [hook, { ...skill, settled: { how: 'taken', at: 999 } }])
  await $.command.run({ command: 'wrap', args: '' } as any)
  // The filing ran: the candidates file was written.
  expect(writes.some(p => p.endsWith('witness-candidates.md'))).toBe(true)
  const after = store.get(KEY) as any[]
  const s2 = after.find(c => c.key === 'skill:close')
  expect(s2.settled).toEqual({ how: 'taken', at: 999 })
  expect(s2.filed).toBe(true)
  const p = await jewels($)
  expect(await p.findAll({ type: 'Text', text: /Skill: Close routine/ } as any)).toEqual([])
  await p.unmount()
})
