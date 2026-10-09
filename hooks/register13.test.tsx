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

test('narrow: the guest stands above and Phi wears the horns for that draw', async ($, on) => {
  world(on)
  await $.session.start(START)
  const band = await $.ui.mount(PROPS(75))
  expect(await band.find({ type: 'Text', text: new RegExp(GUEST_WORDS) })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\/\(/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\)\\/ })).toBeDefined()
  await band.unmount()
  // The costume atom is never written: /wear still reports what Phi wears next.
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
