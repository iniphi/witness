import { test, expect, mock } from 'claude-code/testing'
import { calibrateAllText } from './jewels'

// witness 1.8: `calibrate all` in the Jewels pane. Plugin tests fake the engine, so how the button
// reads in the person's terminal is a live look owed after /reload-plugins.

const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const KEY = 'candidates:c:/work/proj'
const OTHER = 'candidates:c:/work/other-repo'
const hook = { key: 'hook:guard', kind: 'hook', title: 'Guard bare UPDATE', why: 'it recurs', evidence: 'three holds', at: 20, filed: true }
const skill = { key: 'skill:close', kind: 'skill', title: 'Close routine', why: 'same six steps', evidence: 'two closes', at: 30, filed: false }
const foreign = { key: 'hook:far', kind: 'hook', title: 'Far hook', why: 'elsewhere', evidence: 'seen there', at: 40, filed: false }

function world(on: any, store: Map<string, unknown>, filled: string[], draft = ''): void {
  mock.clock(on, { now: 1_000_000 })
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }))
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

test('calibrateAllText numbers each jewel and frames the ask', () => {
  const text = calibrateAllText([
    skill,
    foreign,
  ] as any)
  expect(text).toEqual(
    [
      'Calibrate these 2 witness jewels: for each, give your read, run an adversarial check, record it in the calibration ledger, and put the rulings to me in batches.',
      '',
      '1. Skill: Close routine',
      '   Why: same six steps',
      '   Evidence: two closes',
      '',
      '2. Hook: Far hook',
      '   Why: elsewhere',
      '   Evidence: seen there',
      '',
      'Take them in this order; say which you could not assess.',
    ].join('\n'),
  )
})

test('calibrateAllText caps a long why and evidence with a visible mark', () => {
  const long = { ...hook, why: 'w'.repeat(700), evidence: 'e'.repeat(700) }
  const text = calibrateAllText([long] as any)
  expect(text).toContain(`${'w'.repeat(600)} ... (cut)`)
  expect(text).toContain(`${'e'.repeat(600)} ... (cut)`)
  expect(text).not.toContain('w'.repeat(601))
})

test('calibrate all fills the box once and settles every listed jewel taken', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  const filled: string[] = []
  world(on, store, filled)
  await $.session.start(START)
  const p = await jewels($)
  await $.ui.press({ plugin: 'witness', key: 'jewels-calibrate-all' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]).toContain('Calibrate these 2 witness jewels')
  expect(filled[0]).toContain('Guard bare UPDATE')
  expect(filled[0]).toContain('Close routine')
  expect((store.get(KEY) as any[]).every(c => c.settled?.how === 'taken')).toEqual(true)
  expect(await p.find({ type: 'Text', text: /Close routine/ } as any)).toBeUndefined()
  expect(await p.find({ type: 'Text', text: /Guard bare UPDATE/ } as any)).toBeUndefined()
  await p.unmount()
})

test('calibrate all covers this project only: another project\'s jewel is left untouched', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]], [OTHER, [foreign]]])
  const filled: string[] = []
  world(on, store, filled)
  await $.session.start(START)
  const p = await jewels($)
  await $.ui.press({ plugin: 'witness', key: 'jewels-calibrate-all' } as any)
  expect(filled.length).toEqual(1)
  expect(filled[0]).not.toContain('Far hook')
  expect((store.get(OTHER) as any[])[0].settled).toBeUndefined()
  await p.unmount()
})

test('with one jewel listed there is no calibrate all', { timeoutMs: 15_000 }, async ($, on) => {
  world(on, new Map<string, unknown>([[KEY, [hook]]]), [])
  await $.session.start(START)
  const p = await jewels($)
  expect(await p.find({ type: 'Button', key: 'jewels-calibrate-all' } as any)).toBeUndefined()
  await p.unmount()
})

test('calibrate all over a draft settles nothing', { timeoutMs: 15_000 }, async ($, on) => {
  const store = new Map<string, unknown>([[KEY, [hook, skill]]])
  const filled: string[] = []
  world(on, store, filled, 'half a sentence')
  await $.session.start(START)
  const p = await jewels($)
  await $.ui.press({ plugin: 'witness', key: 'jewels-calibrate-all' } as any)
  expect(filled.length).toEqual(0)
  expect((store.get(KEY) as any[]).every(c => c.settled === undefined)).toEqual(true)
  await p.unmount()
})
