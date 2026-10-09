import { test, expect } from 'claude-code/testing'
import { BOARD_COLOURS, UNAVAILABLE_TICKET, colourFor, ticketFromRun, ticketFromStatus } from './ticket'

const OK_JSON = JSON.stringify({
  board_id: 'overseer',
  inbox_open: 2,
  code_todos_open: 7,
  metered: 'UNMETERED',
  session_log: 'L',
})

test('the colour table resolves the ruled hex values (Global To-Do Project select)', () => {
  expect(colourFor('overseer')).toEqual('#D44C47')
  expect(colourFor('pm')).toEqual('#447ACB')
  expect(colourFor('brand')).toEqual('#CB912F')
  expect(colourFor('stacks')).toEqual('#4C8F69')
  expect(colourFor('voice')).toEqual('#9065B0')
  expect(colourFor('homelab')).toEqual('#9B9A97')
  expect(Object.keys(BOARD_COLOURS).sort()).toEqual(['brand', 'homelab', 'overseer', 'pm', 'stacks', 'voice'])
})

test('router, iniphi, an unknown board and a null board get no bar', () => {
  expect(colourFor('router')).toBeNull()
  expect(colourFor('iniphi')).toBeNull()
  expect(colourFor('203_lightroom')).toBeNull()
  expect(colourFor(null)).toBeNull()
  expect(colourFor(undefined)).toBeNull()
  expect(colourFor('toString')).toBeNull()
})

test('the ticket carries the board colour and a ? for every null count, never 0', () => {
  const t = ticketFromStatus({ board_id: 'pm', inbox_open: null, code_todos_open: null, metered: null })
  expect(t).toEqual({
    kind: 'ok',
    colour: '#447ACB',
    tag: 'pm',
    inbox: '?',
    todos: '?',
    push: '?',
    warnInbox: false,
    warnPush: false,
  })
})

test('a real 0 stays 0 and warnings fire only on inbox > 0 and METERED', () => {
  const zero = ticketFromStatus({ board_id: 'pm', inbox_open: 0, code_todos_open: 0, metered: 'UNMETERED' })
  expect(zero.kind === 'ok' && [zero.inbox, zero.todos, zero.warnInbox, zero.warnPush]).toEqual(['0', '0', false, false])
  const hot = ticketFromStatus({ board_id: 'pm', inbox_open: 3, metered: 'METERED' })
  expect(hot.kind === 'ok' && [hot.warnInbox, hot.warnPush]).toEqual([true, true])
})

test('ticketFromRun accepts exit 0 and exit 2 (partial) JSON', () => {
  const partial = JSON.stringify({ board_id: 'overseer', inbox_open: null, code_todos_open: null, metered: 'METERED' })
  const t = ticketFromRun({ exitCode: 2, stdout: partial })
  expect(t.kind === 'ok' && [t.colour, t.inbox, t.push, t.warnPush]).toEqual(['#D44C47', '?', 'METERED', true])
  expect(ticketFromRun({ exitCode: 0, stdout: OK_JSON }).kind).toEqual('ok')
})

test('a helper that failed, or printed anything but a JSON object, gives the unavailable ticket', () => {
  expect(ticketFromRun(null)).toEqual(UNAVAILABLE_TICKET)
  expect(ticketFromRun({ exitCode: 1, stdout: '{}' })).toEqual(UNAVAILABLE_TICKET)
  expect(ticketFromRun({ exitCode: 0, stdout: 'not json' })).toEqual(UNAVAILABLE_TICKET)
  expect(ticketFromRun({ exitCode: 0, stdout: '[1]' })).toEqual(UNAVAILABLE_TICKET)
  expect(ticketFromRun({ exitCode: 0, stdout: 'null' })).toEqual(UNAVAILABLE_TICKET)
})
