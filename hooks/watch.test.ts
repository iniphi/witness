import { test, expect } from 'claude-code/testing'
import { landedRows, parseRows, parseWatch, watchHeader, watchText } from './watch'
import type { WatchInfo } from '../types'

const FULL = JSON.stringify({
  project: 'demo_project',
  board_id: 'overseer',
  last_session: {
    session_number: 161,
    date: '2026-10-07',
    summary: 'Board folded into Code to-dos. Then more things happened.',
    outstanding: ['a', 'b'],
  },
  focus: 'Keep state coherent',
  inbox: [
    { id: 'r1', agent_from: 'pm', subject: 'first', created_at: '2026-10-07T11:00:00+00:00' },
    { id: 'r2', agent_from: 'router', subject: 'second', created_at: '2026-10-07T12:00:00+00:00' },
  ],
  code_todos_open: 6,
  metered: 'UNMETERED',
  errors: [],
})

const info = (over: Partial<WatchInfo> = {}): WatchInfo => ({
  ...(parseWatch({ exitCode: 0, stdout: FULL }) as WatchInfo),
  ...over,
})

test('parseWatch maps snake_case to camelCase', () => {
  const w = parseWatch({ exitCode: 0, stdout: FULL })
  expect(w?.boardId).toEqual('overseer')
  expect(w?.lastSession?.number).toEqual(161)
  expect(w?.lastSession?.outstanding).toEqual(['a', 'b'])
  expect(w?.inbox?.[1]).toEqual({
    id: 'r2',
    from: 'router',
    subject: 'second',
    createdAt: '2026-10-07T12:00:00+00:00',
  })
  expect(w?.codeTodosOpen).toEqual(6)
})

test('parseWatch carries metered; missing, null or non-string becomes null', () => {
  expect(parseWatch({ exitCode: 0, stdout: FULL })?.metered).toEqual('UNMETERED')
  const withMetered = (m: unknown) =>
    parseWatch({ exitCode: 0, stdout: JSON.stringify({ errors: [], metered: m }) })?.metered
  expect(withMetered('METERED')).toEqual('METERED')
  expect(withMetered(null)).toBeNull()
  expect(withMetered(3)).toBeNull()
  expect(parseWatch({ exitCode: 0, stdout: JSON.stringify({ errors: [] }) })?.metered).toBeNull()
})

test('parseWatch accepts exit 2 with partial JSON and keeps nulls', () => {
  const w = parseWatch({
    exitCode: 2,
    stdout: JSON.stringify({ project: null, inbox: null, errors: ['database unreachable (OSError)'] }),
  })
  expect(w?.inbox).toBeNull()
  expect(w?.lastSession).toBeNull()
  expect(w?.codeTodosOpen).toBeNull()
  expect(w?.errors).toEqual(['database unreachable (OSError)'])
})

test('parseWatch rejects other exit codes, junk and non-objects', () => {
  expect(parseWatch({ exitCode: 1, stdout: FULL })).toBeNull()
  expect(parseWatch({ exitCode: 0, stdout: 'not json' })).toBeNull()
  expect(parseWatch({ exitCode: 0, stdout: '[1,2]' })).toBeNull()
  expect(parseWatch({ exitCode: 0, stdout: '' })).toBeNull()
})

test('parseRows reads the --rows payload', () => {
  const rows = parseRows({ exitCode: 0, stdout: JSON.stringify({ inbox: [{ id: 'x', agent_from: 'pm', subject: 's', created_at: 't' }], errors: [] }) })
  expect(rows).toEqual([{ id: 'x', from: 'pm', subject: 's', createdAt: 't' }])
  expect(parseRows({ exitCode: 0, stdout: JSON.stringify({ inbox: null, errors: ['x'] }) })).toBeNull()
  expect(parseRows({ exitCode: 3, stdout: '{}' })).toBeNull()
})

test('watchHeader names the session handed over and the one starting', () => {
  expect(watchHeader(info())).toEqual('WATCH S161 -> S162')
  expect(watchHeader(info({ lastSession: null }))).toEqual('WATCH')
})

test('watchText gives focus, first sentence, board, to-dos', () => {
  const lines = watchText(info()).split('\n')
  expect(lines).toEqual([
    'Focus: Keep state coherent',
    'Last: Board folded into Code to-dos.',
    '2 open board rows, oldest: first',
    '6 open Code to-dos',
  ])
})

test('watchText cuts a long first sentence to 100 characters', () => {
  const long = 'x'.repeat(300)
  const line = watchText(info({ lastSession: { number: 1, date: 'd', summary: long, outstanding: [] } })).split('\n')[1]!
  expect(line.startsWith('Last: ')).toBe(true)
  expect(line.length - 6).toBeLessThanOrEqual(100)
  expect(line.endsWith('...')).toBe(true)
})

test('watchText keeps null as not measured and a real zero', () => {
  const lines = watchText(
    info({ inbox: [], codeTodosOpen: 0, focus: null, errors: ['no current_focus recorded'] }),
  ).split('\n')
  expect(lines).toContain('0 open board rows')
  expect(lines).toContain('0 open Code to-dos')
  expect(lines.some((l) => l.startsWith('Focus'))).toBe(false)
  expect(lines[lines.length - 1]).toEqual('note: no current_focus recorded')
  const none = watchText(info({ inbox: null, codeTodosOpen: null }))
  expect(none).not.toContain('board row')
  expect(none).not.toContain('open Code to-dos')
})

test('watchText is always 2 to 5 lines', () => {
  const empty = watchText({ project: null, boardId: null, lastSession: null, focus: null, inbox: null, codeTodosOpen: null, metered: null, errors: [] })
  expect(empty.split('\n').length).toBeGreaterThanOrEqual(2)
  const all = watchText(info({ errors: ['a', 'b', 'c'] }))
  expect(all.split('\n').length).toEqual(5)
})

test('landedRows returns only unseen rows and does not mutate', () => {
  const w = info()
  const prev = ['r1'] as const
  expect(landedRows(prev, w).map((r) => r.id)).toEqual(['r2'])
  expect(landedRows([], w).length).toEqual(2)
  expect(landedRows(['r1', 'r2'], w)).toEqual([])
  expect(landedRows(['r1'], info({ inbox: null }))).toEqual([])
  expect(w.inbox?.length).toEqual(2)
})
