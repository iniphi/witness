import { test, expect, mock } from 'claude-code/testing'

// witness 1.3 through the hooks module: the guest seam, against a fake engine. A stand-in
// mod beneath the witness answers ui.render AbovePrompt with a guest host; plugin tests fake
// the engine, so the live look after /reload-plugins is still owed.

const DAY = Date.UTC(2026, 9, 9, 15, 0)
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const ENGINE = { type: 'engine', ref: 0 }
const GUEST_WORDS = 'The guest speaks here'

function world(on: any): void {
  mock.clock(on, { now: DAY })
  mock.store(on, {})
  mock.env(on, { USERPROFILE: 'C:\\Home\\u' })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me-111111' }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  // The stand-in beneath the witness: a guest host with its drawing and the engine's node.
  on('ui.render', { component: 'AbovePrompt' }, () => ({
    type: 'Box',
    props: { key: 'witness-guest', flexDirection: 'column' },
    children: [
      { type: 'Box', props: { key: 'ammonite-facing' }, children: [{ type: 'Text', props: {}, children: [GUEST_WORDS] }] },
      ENGINE,
    ],
  }))
}

const PROPS = (bodyColumns: number) => ({ plugin: 'witness', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns, isWorking: false, hasSurvey: false, maxRows: 30 } }) as any

test('wide: the band keys itself, the guest takes a 44-column column, the engine node stands outside it', { timeoutMs: 15_000 }, async ($, on) => {
  world(on)
  await $.session.start(START)
  const band = await $.ui.mount(PROPS(115))
  expect(await band.find({ type: 'Box', key: 'witness-band' } as any)).toBeDefined()
  const col: any = await band.find({ type: 'Box', key: 'witness-guest-column' } as any)
  expect(col).toBeDefined()
  expect(col.props.width).toEqual(44)
  expect(await band.find({ type: 'Text', text: new RegExp(GUEST_WORDS) })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /asks 0\/0/ })).toBeDefined()
  await band.unmount()
})

test('narrow: the guest stands above and Naut wears the horns for that draw', async ($, on) => {
  world(on)
  await $.session.start(START)
  const band = await $.ui.mount(PROPS(75))
  expect(await band.find({ type: 'Text', text: new RegExp(GUEST_WORDS) })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\/\(/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\)\\/ })).toBeDefined()
  await band.unmount()
  // The costume atom is never written: /wear still reports what Naut wears next.
  const r: any = await $.command.run({ command: 'wear', args: 'none' } as any)
  expect(String(r.text)).toContain('wears nothing')
})

test('the guest\'s words are never recorded as a heads-up note', async ($, on) => {
  world(on)
  await $.session.start(START)
  const band = await $.ui.mount(PROPS(115))
  // A guest read as a note would be voiced in the bubble: the guest's words appear once, in its own column.
  expect((await band.findAll({ type: 'Text', text: new RegExp(GUEST_WORDS) })).length).toEqual(1)
  await band.unmount()
})

// 1.3.6, F9 (2026-10-11, live): after the laptop restarted, a resumed conversation's witness kept
// the fresh id its start ran under; the engine moved to the resumed id with no event in between.
const openAsk = (id: string, text: string) => ({ id, text, source: 'ask', state: 'open', claimId: null, at: DAY - 120_000 })

test('F9: a resumed conversation follows its id and takes its own undone asks back as carried', async ($, on) => {
  let id = 'tmp-000000'
  const store: Record<string, unknown> = {
    'carry:c:/work/proj:res-222222': {
      v: 2,
      sessionId: 'res-222222',
      savedAt: DAY - 60_000,
      ended: false,
      asks: [openAsk('a1', 'Fix the walker'), openAsk('a2', 'Ship the README')],
    },
  }
  mock.clock(on, { now: DAY })
  mock.store(on, store)
  mock.env(on, { USERPROFILE: 'C:\\Home\\u' })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: id }))
  on('session.usage', () => ({ value: { startedAt: DAY } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"asks": []}' } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  await $.session.start(START)
  const before: any = await $.command.run({ command: 'undone', args: '' } as any)
  expect(String(before.text)).not.toContain('carried')
  // The engine moves to the resumed id; the next prompt follows it.
  id = 'res-222222'
  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as any)
  const after: any = await $.command.run({ command: 'undone', args: '' } as any)
  expect(String(after.text)).toContain('2 carried in')
  // Followed again (a hot reload in the same process): nothing is added twice.
  await $.session.start(START)
  const again: any = await $.command.run({ command: 'undone', args: '' } as any)
  expect(String(again.text)).toContain('2 carried in')
})

// 1.3.4: /witness, the companion's own say.
const MANIFEST = '{ "name": "witness", "version": "1.3.4" }'
const ABOUT = (bodyColumns: number) =>
  ({
    plugin: 'witness',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'witness-about',
    props: { title: 'Witness', isFocused: true, bodyColumns, placement: 'dock', scroll: { bodyRows: 40 } },
  }) as any

function aboutWorld(on: any): void {
  world(on)
  on('fs.read', (_$: any, e: any) => ({ value: String(e?.path ?? '').endsWith('plugin.json') ? MANIFEST : '' }))
}

test('/witness opens its pane and says one line naming the manifest version', async ($, on) => {
  aboutWorld(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'witness', args: '' } as any)
  expect(String(r.text)).toContain('witness 1.3.4')
  expect(String(r.text)).toContain('the rest is in the Witness pane')
})

test('wide: the compact Naut and the readout stand in the minor column, the words in the major one', async ($, on) => {
  aboutWorld(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  const pane = await $.ui.mount(ABOUT(100))
  const minor: any = await pane.find({ type: 'Box', key: 'witness-about-minor' } as any)
  expect(minor).toBeDefined()
  expect(minor.props.width).toEqual(38)
  expect(await pane.find({ type: 'Box', key: 'witness-about-major' } as any)).toBeDefined()
  // The compact sprite: its shell top is the 14-column art's first row.
  expect(await pane.find({ type: 'Text', text: /\.__‿_\./ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /I am Naut, the witness/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /none recorded yet/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /New in 1\.3/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /witness 1\.3\.4 · MIT/ })).toBeDefined()
  await pane.unmount()
})

test('narrow: one column, nothing left out', async ($, on) => {
  aboutWorld(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  const pane = await $.ui.mount(ABOUT(60))
  expect(await pane.find({ type: 'Box', key: 'witness-about-minor' } as any)).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /I am Naut, the witness/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /This watch/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\/witness/ })).toBeDefined()
  await pane.unmount()
})

test('with no surface to place the pane, /witness answers with the whole of it as text', async ($, on) => {
  aboutWorld(on)
  on('ui.open', () => {
    throw new Error('no surface')
  })
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'witness', args: '' } as any)
  expect(String(r.text)).toContain('I am Naut, the witness')
  expect(String(r.text)).toContain('This watch:')
  expect(String(r.text)).toContain('New in 1.3:')
})
