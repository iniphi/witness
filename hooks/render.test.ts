import { test, expect } from 'claude-code/testing'

import { TICKET_BAND_KEY, beneathText, bubbleWidth, fitWidth, rowInks, splitBeneath, withCount } from './render'

import { mirror } from './view'

const ENGINE = { type: 'engine', ref: 0 }
const text = (t: string) => ({ type: 'Text', props: {}, children: [t] })

test('nothing beneath: the engine element is kept, no ticket, no note', () => {
  expect(splitBeneath(ENGINE)).toEqual({ ticket: null, note: null, engine: ENGINE })
  expect(splitBeneath(undefined)).toEqual({ ticket: null, note: null, engine: undefined })
})

test('a note beneath (the Heads up) is voiced, never treated as the ticket', () => {
  const note = text('Heads up')
  expect(splitBeneath(note)).toEqual({ ticket: null, note, engine: null })
})

test('beneathText reads the note from beneath as drawn: runs joined, boxes apart, never the ticket or the engine', () => {
  expect(beneathText(ENGINE)).toBe('')
  expect(beneathText(undefined)).toBe('')
  const runs = { type: 'Text', props: {}, children: ['Heads up', { type: 'Text', props: {}, children: [': try '] }, '/fast'] }
  const box = { type: 'Box', props: {}, children: [runs, ENGINE, text('  second   line ')] }
  expect(beneathText(box)).toBe('Heads up: try /fast second line')
  const band = { type: 'Box', props: { key: TICKET_BAND_KEY }, children: [text('overseer: inbox 5'), text('Heads up')] }
  expect(beneathText(band)).toBe('Heads up')
  expect(beneathText({ type: 'Box', props: { key: TICKET_BAND_KEY }, children: [text('ticket'), ENGINE] })).toBe('')
})

test('the ticket band beneath is pulled apart: ticket on top, its own beneath voiced', () => {
  const ticket = text('overseer: inbox 5')
  const note = text('Heads up')
  const band = { type: 'Box', props: { key: TICKET_BAND_KEY }, children: [ticket, note] }
  expect(splitBeneath(band)).toEqual({ ticket, note, engine: null })
  const quiet = { type: 'Box', props: { key: TICKET_BAND_KEY }, children: [ticket, ENGINE] }
  expect(splitBeneath(quiet)).toEqual({ ticket, note: null, engine: ENGINE })
})

// Seen live (S162): a note sized to the whole band spilled off the left edge of the bubble.
test('fitWidth brings every wider numeric width down to the bubble, and touches nothing else', () => {
  const press = { handle: 7 }
  const note = {
    type: 'Box',
    props: { width: 100, flexDirection: 'column' },
    children: [
      { type: 'Text', props: { dimColor: true }, children: ['Heads up'] },
      { type: 'Box', props: { width: '100%' }, children: [{ type: 'Button', props: { label: 'Dismiss' }, press }] },
      { type: 'Box', props: { width: 20 }, children: [] },
      ENGINE,
    ],
  }
  const fitted = fitWidth(note, 50)
  expect(fitted.props.width).toEqual(50)
  expect(fitted.props.flexDirection).toEqual('column')
  expect(fitted.children[0]).toEqual(note.children[0])
  expect(fitted.children[1].props.width).toEqual('100%')
  expect(fitted.children[1].children[0].press).toBe(press)
  expect(fitted.children[2].props.width).toEqual(20)
  expect(fitted.children[3]).toBe(ENGINE)
  expect(note.props.width).toEqual(100)
})

test('bubbleWidth: a note takes the room, the companion\'s own words what they need', () => {
  expect(bubbleWidth(60, null)).toEqual(60)
  expect(bubbleWidth(60, { header: 'WATCH', text: 'Watch taken.' })).toEqual(16)
  expect(bubbleWidth(30, { header: 'HELD', text: 'x'.repeat(200) })).toEqual(30)
  expect(bubbleWidth(2, null)).toEqual(5)
  // The queue's footer sits beside the text, so the bubble makes room for it.
  expect(bubbleWidth(60, { header: 'WATCH', text: 'Watch taken.' }, '0: Dismiss <1/2>')).toEqual(33)
  expect(bubbleWidth(30, { header: 'HELD', text: 'short' }, '0: Dismiss')).toEqual(20)
})

test('withCount sets <n/m> just after the note\'s own Dismiss, on the same row', () => {
  const COUNT = text(' <1/2>')
  const dismissBtn = { type: 'Button', props: { label: 'Dismiss', hotkey: '0', plain: true }, children: [] }
  const row = { type: 'Box', props: { flexDirection: 'row' }, children: [dismissBtn] }
  const note = { type: 'Box', props: { flexDirection: 'column' }, children: [text('Heads up'), row] }
  const r = withCount(note, COUNT)
  expect(r.placed).toBe(true)
  expect(r.tree.children[1].children).toEqual([dismissBtn, COUNT])
  expect(r.tree.children[0]).toBe(note.children[0])
  expect(note.children[1].children).toEqual([dismissBtn])
})

test('withCount leaves a note untouched when its Dismiss is not in a row', () => {
  const dismissBtn = { type: 'Button', props: { label: 'Dismiss' }, children: [] }
  const column = { type: 'Box', props: { flexDirection: 'column' }, children: [text('Heads up'), dismissBtn] }
  expect(withCount(column, text('<1/2>'))).toEqual({ tree: column, placed: false })
  expect(withCount(text('no controls'), text('<1/2>')).placed).toBe(false)
  expect(withCount(ENGINE, text('<1/2>'))).toEqual({ tree: ENGINE, placed: false })
})

test('rowInks: the chime and the barnacles take their inks, the eyes the warning colour only when metered (1.1)', () => {
  const view: any = { bells: [[1, 13], [2, 13], [3, 13], [4, 13]], barnacles: [[1, 9]], eyes: [[2, 3]], costume: [[3, 2], [3, 1], [3, 0]] }
  expect(rowInks(view, 1, false)).toEqual([{ col: 9, color: '#B59670' }, { col: 13, color: '#649090' }])
  expect(rowInks(view, 2, true)).toEqual([{ col: 3, color: 'warning' }, { col: 13, color: '#649090' }])
  expect(rowInks(view, 2, false)).toEqual([{ col: 13, color: '#649090' }])
  expect(rowInks(view, 3, false)).toEqual([{ col: 0, color: 'error' }, { col: 1, color: 'error' }, { col: 2, color: 'error' }, { col: 13, color: '#649090' }])
  expect(rowInks(view, 0, true)).toEqual([])
})

test('mirror turns the nautilus to face left, keeping every width', () => {
  const rows = [' .--~-.     ', ' / .-. \\    ', '| ( @ ) o>~ ']
  const m = mirror(rows)
  expect(m.map(r => r.length)).toEqual(rows.map(r => r.length))
  expect(m[2]).toEqual(' ~<o ( @ ) |')
  expect(m[1]).toEqual('    / .-. \\ ')
  expect(mirror(m)).toEqual(rows)
})
