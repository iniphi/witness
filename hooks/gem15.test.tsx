import { test, expect, mock } from 'claude-code/testing'

// witness 1.5 through the hooks module: the gem on the shell, and the Candidates section of the
// Barnacles pane. Plugin tests fake the engine, so how `success` and `suggestion` read on the
// band in the person's terminal is a live look owed after /reload-plugins.

const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const KEY = 'candidates:c:/work/proj'
const hook = { key: 'hook:guard', kind: 'hook', title: 'Guard bare UPDATE', why: 'it recurs', evidence: 'three holds', at: 20, filed: true }
const skill = { key: 'skill:close', kind: 'skill', title: 'Close routine', why: 'same six steps', evidence: 'two closes', at: 30, filed: false }
const old = { key: 'hook:old', kind: 'hook', title: 'Older', why: 'w', evidence: 'e', at: 10, filed: false }

function world(on: any, store: Map<string, unknown>, draft = '', filled: string[] = [], fills = true): void {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
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
  on('ui.open', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$: any, e: any) => {
    filled.push(e.text)
    return { isFilled: fills }
  })
}

const pane = ($: any) =>
  $.ui.mount({
    plugin: 'witness',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'witness-jewels',
    props: { title: 'Jewels', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 20 } },
  } as any)

const band = ($: any) =>
  $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 100 } } as any)

test('a waiting candidate is a gem on the band, green for a hook and blue for a skill; a filed one still shows', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [hook, skill]]]))
  await $.session.start(START)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', color: 'success' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', color: 'suggestion' } as any)).toBeDefined()
  await ui.unmount()
})

test('/barnacles opens on a candidate alone and counts it; the Jewels pane lists newest first with take and dismiss', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [old, hook, skill]]]))
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'barnacles', args: '' } as any)
  expect(String(r.text)).toContain('3 candidates waiting')
  const p = await pane($)
  const lines = (await p.findAll({ type: 'Text', text: /(Hook|Skill): / })).length
  expect(lines).toEqual(3)
  expect(await p.find({ type: 'Button', key: 'take-skill:close' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'dismiss-hook:old' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'jewels-calibrate-all' } as any)).toBeDefined()
  expect(await p.find({ type: 'Button', key: 'jewels-dismiss-all' } as any)).toBeUndefined()
  await p.unmount()
})

test('with nothing on the shell /barnacles says so', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>())
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'barnacles', args: '' } as any)
  expect(String(r.text)).toContain('no candidates')
})

test('dismiss reads the store fresh, so a second session\'s candidate is kept, and takes the gem off', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  world(on, store)
  await $.session.start(START)
  const p = await pane($)
  // Another live session mints a candidate after this one loaded.
  store.set(KEY, [hook, skill, old])
  await $.ui.press({ plugin: 'witness', key: 'dismiss-skill:close' } as any)
  const kept = store.get(KEY) as any[]
  expect(kept.map(c => c.key)).toEqual(['hook:guard', 'skill:close', 'hook:old'])
  expect(kept[1].settled.how).toEqual('dismissed')
  expect(kept[0].settled).toBeUndefined()
  expect(kept[2].settled).toBeUndefined()
  await p.unmount()
})

test('calibrate all settles every waiting candidate taken (dismiss all is gone)', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  world(on, store)
  await $.session.start(START)
  const p = await pane($)
  await $.ui.press({ plugin: 'witness', key: 'jewels-calibrate-all' } as any)
  expect((store.get(KEY) as any[]).every(c => c.settled?.how === 'taken')).toEqual(true)
  await p.unmount()
  const r: any = await $.command.run({ command: 'barnacles', args: '' } as any)
  expect(String(r.text)).toContain('no candidates')
})

test('take fills the prompt box and settles taken; over a draft, or a box that will not take it, it settles nothing', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  const filled: string[] = []
  world(on, store, '', filled)
  await $.session.start(START)
  const p = await pane($)
  await $.ui.press({ plugin: 'witness', key: 'take-hook:guard' } as any)
  expect(filled).toEqual([
    'A witness hook candidate: Guard bare UPDATE. Why: it recurs. Evidence: three holds. Propose how to build it as a hook, or say why it should not be built.',
  ])
  const after = store.get(KEY) as any[]
  expect(after[0].settled.how).toEqual('taken')
  expect(after[1].settled).toBeUndefined()
  await p.unmount()
})

test('take never writes over a draft and leaves the gem on', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook]]])
  const filled: string[] = []
  world(on, store, 'half a thought', filled)
  await $.session.start(START)
  const p = await pane($)
  await $.ui.press({ plugin: 'witness', key: 'take-hook:guard' } as any)
  expect(filled).toEqual([])
  expect((store.get(KEY) as any[])[0].settled).toBeUndefined()
  await p.unmount()
})

test('take leaves the gem on when the box would not take it', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook]]])
  world(on, store, '', [], false)
  await $.session.start(START)
  const p = await pane($)
  await $.ui.press({ plugin: 'witness', key: 'take-hook:guard' } as any)
  expect((store.get(KEY) as any[])[0].settled).toBeUndefined()
  await p.unmount()
})
