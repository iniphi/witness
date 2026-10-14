import { test, expect } from 'claude-code/testing'
import { bodyFromOption, colourFor, moodFor, speechBox } from './body'
import type { MoodInput } from './body'

test('bodyFromOption: naut and the older phi are the same nautilus; phial and unknown values as before', () => {
  expect(bodyFromOption('naut')).toEqual('phi')
  expect(bodyFromOption('phi')).toEqual('phi')
  expect(bodyFromOption('phial')).toEqual('phial')
  expect(bodyFromOption('flask')).toEqual('phi')
  expect(bodyFromOption('')).toEqual('phi')
  expect(bodyFromOption(undefined)).toEqual('phi')
  expect(bodyFromOption(7)).toEqual('phi')
})

test('colourFor endpoints, midpoint and null', () => {
  expect(colourFor('phi', 0)).toEqual('#CFC8BC')
  expect(colourFor('phi', 1)).toEqual('#876D4C')
  expect(colourFor('phial', 0)).toEqual('#BFD0D3')
  expect(colourFor('phial', 1)).toEqual('#B9771F')
  expect(colourFor('phi', null)).toEqual('#CFC8BC')
  expect(colourFor('phial', null)).toEqual('#BFD0D3')
  expect(colourFor('phi', 0.5)).toEqual('#AB9B84')
  expect(colourFor('phial', 0.5)).toEqual('#BCA479')
  expect(colourFor('phi', 7)).toEqual('#876D4C')
  expect(colourFor('phi', -1)).toEqual('#CFC8BC')
})

const BASE: MoodInput = {
  held: false, working: false, idle: false, pale: 0, claims: 0, asksDone: 0, asksTotal: 0, rowsLanded: false,
}
const m = (o: Partial<MoodInput>) => moodFor({ ...BASE, ...o })

test('moodFor precedence', () => {
  expect(m({})).toEqual('calm')
  expect(m({ held: true, rowsLanded: true, idle: true, pale: 2 })).toEqual('shielding')
  expect(m({ rowsLanded: true, idle: true, pale: 2 })).toEqual('alert')
  expect(m({ idle: true, pale: 2 })).toEqual('resting')
  expect(m({ pale: 1, claims: 1, asksDone: 2, asksTotal: 2 })).toEqual('doubtful')
  expect(m({ claims: 2, asksDone: 3, asksTotal: 3 })).toEqual('proud')
  expect(m({ claims: 0, asksDone: 3, asksTotal: 3 })).toEqual('calm')
  expect(m({ claims: 2, asksDone: 0, asksTotal: 0 })).toEqual('calm')
  expect(m({ claims: 2, asksDone: 1, asksTotal: 3 })).toEqual('calm')
})


test('speechBox rows are exactly width wide with a header in the top border', () => {
  const rows = speechBox({ header: 'HELD', text: 'one two three four five six', width: 20, maxHeight: 10, tailRow: 1 })
  for (const r of rows) expect(r.length).toEqual(20)
  expect(rows[0]!.startsWith('╭─ HELD ─')).toEqual(true)
  expect(rows[0]!.endsWith('╮')).toEqual(true)
  expect(rows[rows.length - 1]).toEqual('╰' + '─'.repeat(18) + '╯')
  expect(rows[1]).toEqual('< one two three    │')
  expect(rows.length).toEqual(2 + 2)
})

test('speechBox puts the tail on the chosen text row', () => {
  const rows = speechBox({ header: 'H', text: 'aaa bbb ccc ddd eee fff', width: 10, maxHeight: 12, tailRow: 3 })
  expect(rows.filter((r) => r[0] === '<').length).toEqual(1)
  expect(rows[3]![0]).toEqual('<')
  expect(rows[1]![0]).toEqual('│')
  expect(rows[0]![0]).toEqual('╭')
})

test('speechBox caps the height and ends the cut line with ...', () => {
  const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'
  const rows = speechBox({ header: 'PRINT', text, width: 16, maxHeight: 5, tailRow: 1 })
  expect(rows.length).toEqual(5)
  for (const r of rows) expect(r.length).toEqual(16)
  expect(rows[3]).toContain('...')
  expect(rows[4]![0]).toEqual('╰')
})

test('speechBox keeps short text uncut and splits overlong words', () => {
  const rows = speechBox({ header: 'X', text: 'hi', width: 12, maxHeight: 6, tailRow: 1 })
  expect(rows.join('')).not.toContain('...')
  const long = speechBox({ header: 'X', text: 'abcdefghijklmnopqrstuvwxyz', width: 10, maxHeight: 10, tailRow: 1 })
  for (const r of long) expect(r.length).toEqual(10)
})
