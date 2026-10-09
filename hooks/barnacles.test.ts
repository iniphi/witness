import { test, expect } from 'claude-code/testing'
import type { Barnacle, Friction } from '../types'
import {
  FRICTION_CAP,
  frictionFrom,
  markSpoken,
  mergeBarnacles,
  nextToSpeak,
  noteFriction,
  parseRecur,
  recurPrompt,
} from './barnacles'

const f = (key: string, at = 0): Friction => ({ kind: 'tool-failure', key, at, detail: 'd' })
const call = (tool: string, input: unknown = {}, isError = false, at = 0) => ({ tool, input, isError, at })
const base = { input: {} as unknown, resultText: '', isError: false, recent: [] as ReturnType<typeof call>[] }

test('noteFriction appends and keeps the newest 200', () => {
  let log: Friction[] = []
  for (let i = 0; i < FRICTION_CAP + 5; i++) log = noteFriction(log, f('k', i))
  expect(log.length).toEqual(FRICTION_CAP)
  expect(log[0]!.at).toEqual(5)
  expect(log[log.length - 1]!.at).toEqual(FRICTION_CAP + 4)
  const short = noteFriction([], f('k'))
  expect(short.length).toEqual(1)
})

test('frictionFrom flags a cancelled execute_sql write', () => {
  const out = frictionFrom({
    ...base,
    tool: 'mcp__claude_ai_Supabase__execute_sql',
    input: {},
    resultText: '{"status":"cancelled"}',
    at: 7,
  })
  expect(out.length).toEqual(1)
  expect(out[0]!.kind).toEqual('cancelled-write')
  expect(out[0]!.at).toEqual(7)
})

// A field report (pm): the print reported three cancelled writes when the session had
// none; every write ran once and returned its row. A row's data saying "cancelled" is not a cancel.
test('a successful execute_sql whose rows mention a cancel is not a cancelled write', () => {
  const sql = 'mcp__claude_ai_Supabase__execute_sql'
  const rows = '<untrusted-data-1>\n[{"id":"x","status":"cancelled","note":"write cancelled at the prompt"}]\n</untrusted-data-1>'
  expect(frictionFrom({ ...base, tool: sql, resultText: rows })).toEqual([])
  // The witness hold's own refusal is a cancel.
  const held = frictionFrom({ ...base, tool: sql, isError: true, resultText: 'witness: held and cancelled - an UPDATE or DELETE must name what it touched' })
  expect(held.map((x) => x.detail)).toEqual(['write cancelled at the prompt'])
})

test('frictionFrom flags a denied call', () => {
  const out = frictionFrom({ ...base, tool: 'Bash', isError: true, resultText: 'Permission to use Bash was denied' })
  expect(out.map((x) => x.kind)).toEqual(['cancelled-write'])
  expect(frictionFrom({ ...base, tool: 'Bash', resultText: 'ok' })).toEqual([])
})

test('frictionFrom flags the second consecutive failure of one tool', () => {
  const second = frictionFrom({
    ...base,
    tool: 'Bash',
    isError: true,
    resultText: 'exit 1',
    recent: [call('Bash', {}, true, 5), call('Read', {}, false, 6)],
  })
  expect(second.map((x) => [x.kind, x.key])).toEqual([['tool-failure', 'Bash']])
  const first = frictionFrom({
    ...base,
    tool: 'Bash',
    isError: true,
    resultText: 'exit 1',
    recent: [call('Bash', {}, false, 5), call('Bash', {}, true, 6), call('Bash', {}, false, 7)],
  })
  expect(first).toEqual([])
  expect(frictionFrom({ ...base, tool: 'Bash', isError: false, recent: [call('Bash', {}, true)] })).toEqual([])
})

test('frictionFrom flags the third edit of one file, once', () => {
  const p = { file_path: 'C:\\Work\\A.ts' }
  const two = [call('Edit', p, false, 1), call('Write', { file_path: 'c:/work/a.ts' }, false, 2), call('Edit', { file_path: 'other' }, false, 3)]
  const third = frictionFrom({ ...base, tool: 'Edit', input: p, recent: two, at: 9 })
  expect(third.map((x) => [x.kind, x.key, x.at])).toEqual([['re-edit', 'c:/work/a.ts', 9]])
  const fourth = frictionFrom({ ...base, tool: 'Edit', input: p, recent: [...two, call('Edit', p, false, 4)] })
  expect(fourth).toEqual([])
  expect(frictionFrom({ ...base, tool: 'Edit', input: p, recent: two.slice(0, 1) })).toEqual([])
  expect(frictionFrom({ ...base, tool: 'Edit', input: null, recent: two })).toEqual([])
})

test('recurPrompt carries the fixed text first and the keys last', () => {
  const log = [f('Bash', Date.UTC(2026, 9, 1)), f('Bash', Date.UTC(2026, 9, 2))]
  const p = recurPrompt(log, [{ key: 'old', text: 'was bad', spoken: true }])
  expect(p.indexOf('Reply with the JSON only.') < p.indexOf('key=Bash')).toEqual(true)
  expect(p.includes('days=2026-10-01,2026-10-02')).toEqual(true)
  expect(p.includes('- old: was bad')).toEqual(true)
  expect(p.includes('{"barnacles":')).toEqual(true)
})

test('parseRecur is tolerant, validates, dedupes and caps at 6', () => {
  expect(parseRecur('{"barnacles": [{"key": "Bash", "text": " Bash keeps failing. "}]}')).toEqual([
    { key: 'Bash', text: 'Bash keeps failing.', spoken: false },
  ])
  expect(parseRecur('```json\n{"barnacles": []}\n```')).toEqual([])
  expect(parseRecur('words {"barnacles": [{"key": "k", "text": "t"}]} words').length).toEqual(1)
  expect(parseRecur('junk')).toEqual([])
  expect(parseRecur('{"barnacles": [{"key": 1, "text": "t"}, {"key": "a"}, "x", null]}')).toEqual([])
  const dup = parseRecur('{"barnacles": [{"key": "k", "text": "a"}, {"key": "k", "text": "b"}]}')
  expect(dup.length).toEqual(1)
  const many = JSON.stringify({ barnacles: Array.from({ length: 9 }, (_, i) => ({ key: 'k' + i, text: 't' })) })
  expect(parseRecur(many).length).toEqual(6)
})

test('mergeBarnacles keeps spoken flags; nextToSpeak and markSpoken walk the list', () => {
  const known: Barnacle[] = [{ key: 'a', text: 'A', spoken: true }]
  const parsed: Barnacle[] = [
    { key: 'a', text: 'A2', spoken: false },
    { key: 'b', text: 'B', spoken: false },
  ]
  const merged = mergeBarnacles(known, parsed)
  expect(merged.map((b) => b.spoken)).toEqual([true, false])
  expect(nextToSpeak(merged)?.key).toEqual('b')
  const after = markSpoken(merged, 'b')
  expect(nextToSpeak(after)).toEqual(null)
  expect(merged[1]!.spoken).toEqual(false)
  expect(nextToSpeak([])).toEqual(null)
})
