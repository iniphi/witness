import { test, expect } from 'claude-code/testing'

import type { Ask, Claim, Ledger } from '../types'
import { ABOUT_SIDE_MIN, aboutColumns, aboutModel, aboutReply, aboutText, commandRows, intro, readout, versionOf, workText } from './about'
import type { AboutInput } from './about'

const LEDGER: Ledger = { writes: [], claims: [], turns: {} }

const ask = (id: string, state: Ask['state'], source: Ask['source'] = 'typed'): Ask => ({ id, text: `ask ${id}`, source, state, claimId: null, at: 0 })
const claim = (id: string, state: Claim['state']): Claim => ({ id, turnId: 't', text: 'done', at: 0, writeIds: [], state })

const base: AboutInput = {
  body: 'phi',
  version: '1.3.4',
  asks: [],
  ledger: LEDGER,
  activity: { activeMs: 0, lastAt: null },
  barnacles: [],
  hold: null,
  pods: null,
  costume: 'none',
  metered: false,
}

const value = (rows: ReturnType<typeof readout>, label: string): string | undefined => rows.find(r => r.label === label)?.value

test('the version is read from the manifest, and only a plain x.y.z counts', () => {
  expect(versionOf('{ "name": "witness", "version": "1.3.4" }')).toEqual('1.3.4')
  expect(versionOf('{ "version": "1.3" }')).toBeNull()
  expect(versionOf('not json')).toBeNull()
  expect(versionOf(undefined)).toBeNull()
  expect(aboutModel({ ...base, version: null }).title).toEqual('witness')
})

test('Naut and Phial each introduce themselves, and what deepens is their own', () => {
  expect(intro('phi')[0]).toContain('I am Naut, the witness: a nautilus')
  expect(intro('phi')[1]).toContain('my shell deepens')
  expect(intro('phial')[0]).toContain('I am Phial, the witness: a round-bottom flask')
  expect(intro('phial')[1]).toContain('my glass deepens')
})

test('active time reads as hours and minutes', () => {
  expect(workText(0)).toEqual('0m')
  expect(workText(25 * 60_000)).toEqual('25m')
  expect(workText(100 * 60_000)).toEqual('1h 40m')
})

test('an empty watch says so in words, never as zeros', () => {
  const rows = readout(base)
  expect(value(rows, 'asks')).toEqual('none recorded yet')
  expect(value(rows, 'claims')).toEqual('none made yet')
  expect(value(rows, 'barnacles')).toEqual('none: nothing recurs')
  expect(value(rows, 'writes')).toEqual('nothing held')
  expect(value(rows, 'pods')).toEqual('sonar off')
  // Rows with nothing to say are left out.
  expect(value(rows, 'carried')).toBeUndefined()
  expect(value(rows, 'push')).toBeUndefined()
  expect(value(rows, 'wearing')).toBeUndefined()
})

test('a busy watch: asks, claims, carried, builds, a held write, pods, a metered eye and a costume', () => {
  const rows = readout({
    ...base,
    asks: [ask('a', 'witnessed'), ask('b', 'claimed'), ask('c', 'open'), ask('d', 'open', 'carried'), ask('e', 'open', 'build')],
    ledger: { ...LEDGER, claims: [claim('c1', 'developed'), claim('c2', 'pale')] },
    activity: { activeMs: 75 * 60_000, lastAt: 1 },
    barnacles: [{ key: 'k', text: 'Bash fails', spoken: true }],
    hold: { toolUseId: 'u', sql: 'UPDATE x SET y = 1', fixed: null, at: 1 },
    pods: 2,
    costume: 'razor',
    metered: true,
  })
  expect(value(rows, 'asks')).toEqual('1 of 3 witnessed, 1 pale')
  expect(value(rows, 'carried')).toEqual('1 from the last watch')
  expect(value(rows, 'builds')).toEqual('1 for the to-do list')
  expect(value(rows, 'claims')).toEqual('1 of 2 read back')
  expect(value(rows, 'bells')).toEqual('1h 15m of work')
  expect(value(rows, 'barnacles')).toEqual('1 barnacle on the shell')
  expect(rows.find(r => r.label === 'writes')).toEqual({ label: 'writes', value: 'one held for your answer', tone: 'error' })
  expect(value(rows, 'pods')).toEqual('2 other live sessions')
  expect(rows.find(r => r.label === 'push')?.tone).toEqual('warning')
  expect(value(rows, 'wearing')).toEqual('the razor, on the band')
})

test('the sonar\'s commands are listed only where the sonar is on', () => {
  const off = commandRows(false).map(c => c.name)
  const on = commandRows(true).map(c => c.name)
  expect(off).not.toContain('/pods')
  expect(off).not.toContain('/hand')
  expect(off).toContain('/witness')
  expect(on).toContain('/pods')
  expect(on).toContain('/hand')
  expect(aboutModel({ ...base, pods: 0 }).commands.map(c => c.name)).toContain('/hand')
})

test('the reply is one line when the pane is placed, and the whole text when it is not', () => {
  const m = aboutModel(base)
  expect(aboutReply(m, true)).toEqual('Naut: I count a thing done only when I have seen it. witness 1.3.4 - the rest is in the Witness pane.')
  const text = aboutReply(m, false)
  expect(text).toEqual(aboutText(m))
  expect(text).toContain('This watch:')
  expect(text).toContain('New in 1.3:')
  expect(text).toContain('github.com/iniphi/witness')
})

test('the golden section seats the creature beside its words from 80 columns, never narrower than the sprite', () => {
  expect(aboutColumns(ABOUT_SIDE_MIN - 1).side).toBe(false)
  const at80 = aboutColumns(80)
  expect(at80).toEqual({ side: true, left: 31, right: 46 })
  const wide = aboutColumns(140)
  expect(wide.left).toEqual(53)
  expect(wide.left + wide.right + 3).toEqual(140)
})
