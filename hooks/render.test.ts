import { test, expect } from 'claude-code/testing'

import {
  BAND_KEY,
  GUEST_KEY,
  GUEST_MIN_BODY,
  GUEST_SHARE,
  TICKET_BAND_KEY,
  bandTree,
  beneathText,
  bubbleWidth,
  fitWidth,
  rowInks,
  splitBeneath,
  withCount,
} from './render'

import { mirror } from './view'

const ENGINE = { type: 'engine', ref: 0 }
const text = (t: string) => ({ type: 'Text', props: {}, children: [t] })

// The first test of the file pays the cold load: a budget for a loaded machine (S170).
test('nothing beneath: the engine element is kept, no ticket, no note', { timeoutMs: 15_000 }, () => {
  expect(splitBeneath(ENGINE)).toEqual({ ticket: null, note: null, engine: ENGINE, guest: null })
  expect(splitBeneath(undefined)).toEqual({ ticket: null, note: null, engine: undefined, guest: null })
})

test('a note beneath (the Heads up) is voiced, never treated as the ticket', () => {
  const note = text('Heads up')
  expect(splitBeneath(note)).toEqual({ ticket: null, note, engine: null, guest: null })
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
  expect(splitBeneath(band)).toEqual({ ticket, note, engine: null, guest: null })
  const quiet = { type: 'Box', props: { key: TICKET_BAND_KEY }, children: [ticket, ENGINE] }
  expect(splitBeneath(quiet)).toEqual({ ticket, note: null, engine: ENGINE, guest: null })
})

// 1.3: the guest seam. A mod folded beneath returns <Box key="witness-guest">{guest}{below}</Box>.
const GUEST = { type: 'Box', props: { key: 'ammonite-facing' }, children: [text('Ammonite words')] }
const host = (...rest: unknown[]) => ({ type: 'Box', props: { key: GUEST_KEY }, children: [GUEST, ...rest] })

test('the seam keys and sizes are the contract', () => {
  expect(BAND_KEY).toBe('witness-band')
  expect(GUEST_KEY).toBe('witness-guest')
  expect(GUEST_SHARE).toBe(0.382)
  expect(GUEST_MIN_BODY).toBe(104)
})

test('a guest host is lifted out and the rest split as before, in either nesting order', () => {
  const ticket = text('overseer: inbox 5')
  const note = text('Heads up')
  expect(splitBeneath(host(ENGINE))).toEqual({ ticket: null, note: null, engine: ENGINE, guest: GUEST })
  expect(splitBeneath(host(note))).toEqual({ ticket: null, note, engine: null, guest: GUEST })
  const tickBand = (rest: unknown) => ({ type: 'Box', props: { key: TICKET_BAND_KEY }, children: [ticket, rest] })
  // The host outside the ticket band, and the host inside it.
  expect(splitBeneath(host(tickBand(ENGINE)))).toEqual({ ticket, note: null, engine: ENGINE, guest: GUEST })
  expect(splitBeneath(host(tickBand(note)))).toEqual({ ticket, note, engine: null, guest: GUEST })
  expect(splitBeneath(tickBand(host(ENGINE)))).toEqual({ ticket, note: null, engine: ENGINE, guest: GUEST })
  expect(splitBeneath(tickBand(host(note)))).toEqual({ ticket, note, engine: null, guest: GUEST })
})

test('the guest\'s words are never read as a heads-up note', () => {
  expect(beneathText(host(ENGINE))).toBe('')
  expect(beneathText(host(text('Heads up')))).toBe('Heads up')
})

// A stand-in element table: the JSX factory builds nodes from these tags.
const TABLE = { Box: 'Box', Text: 'Text', Button: 'Button' }
const kids = (n: any): any[] => {
  const c = n?.children ?? n?.props?.children
  return c === undefined || c === null ? [] : Array.isArray(c) ? c.flat(Infinity) : [c]
}
function find(n: any, pred: (n: any) => boolean): any[] {
  if (n === null || typeof n !== 'object') return []
  return [...(pred(n) ? [n] : []), ...kids(n).flatMap(c => find(c, pred))]
}
/** Engine nodes found under any Box that has a numeric or percent width. */
function engineUnderWidth(n: any, sized: boolean): number {
  if (n === null || typeof n !== 'object') return 0
  if (n.type === 'engine') return sized ? 1 : 0
  const w = n.props?.width
  const here = sized || (n.type === 'Box' && w !== undefined)
  return kids(n).reduce((a: number, c: any) => a + engineUnderWidth(c, here), 0)
}

function bandFor(body: number, below: unknown): any {
  const view: any = { size: 'compact', sprite: [' ', ' ', ' ', ' ', ' '], colour: undefined, safelight: false, eyes: [], bells: [], barnacles: [], hookGems: [], skillGems: [], costume: [], blush: [], status: 'asks 0/0', speech: [], bubble: null }
  return bandTree(TABLE, body, view, below, 2, null)
}

test('bandTree: the root carries the band key; without a guest nothing else changes', () => {
  const tree = bandFor(115, ENGINE)
  expect(tree.props.key).toBe(BAND_KEY)
  expect(find(tree, n => n.props?.key === 'witness-guest-column')).toEqual([])
  expect(kids(tree).at(-1)).toBe(ENGINE)
})

test('bandTree with a guest: wide takes a 38.2 column and witness the rest; narrow stacks the guest above', () => {
  const wide = bandFor(115, host(ENGINE))
  const col = find(wide, n => n.props?.key === 'witness-guest-column')
  expect(col.length).toBe(1)
  expect(col[0].props.width).toBe(44)
  expect(col[0].props.flexShrink).toBe(0)
  expect(find(col[0], n => n === GUEST).length).toBe(1)
  expect(kids(wide).at(-1)).toBe(ENGINE)
  expect(engineUnderWidth(wide, false)).toBe(0)
  const edge = bandFor(GUEST_MIN_BODY, host(ENGINE))
  expect(find(edge, n => n.props?.key === 'witness-guest-column').length).toBe(1)
  const narrow = bandFor(75, host(ENGINE))
  expect(find(narrow, n => n.props?.key === 'witness-guest-column')).toEqual([])
  expect(find(narrow, n => n === GUEST).length).toBe(1)
  expect(engineUnderWidth(narrow, false)).toBe(0)
  expect(kids(narrow).at(-1)).toBe(ENGINE)
  // The guest above is in a wrapper with no width of its own.
  const holder = find(narrow, n => kids(n).includes(GUEST))[0]
  expect(holder.props?.width).toBeUndefined()
  // With a note and no engine beneath, nothing sized holds an engine node either.
  expect(engineUnderWidth(bandFor(115, host(text('Heads up'))), false)).toBe(0)
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
  const view: any = { bells: [[1, 13], [2, 13], [3, 13], [4, 13]], barnacles: [[1, 9]], hookGems: [], skillGems: [], eyes: [[2, 3]], costume: [[3, 2], [3, 1], [3, 0]], blush: [] }
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
