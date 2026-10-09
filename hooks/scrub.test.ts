import { test, expect } from 'claude-code/testing'

import type { Barnacle, Friction } from '../types'
import { afterScrub, asScrubbed, realFriction, regrown, scrub, stampScrub, unscrub } from './barnacles'

const f = (key: string, at: number): Friction => ({ kind: 'tool-failure', key, at, detail: `${key} failed twice in a row` })
const B: Barnacle[] = [
  { key: 'a.ts', text: 'a.ts keeps needing a third edit.', spoken: true },
  { key: 'b.ts', text: 'b.ts keeps needing a third edit.', spoken: false },
]

// /barnacles (1.1, Bradley 2026-10-09): a scrub takes the barnacle off the shell; the
// recurrence pass then reads only friction logged after the scrub for that key; and the
// moment the same friction is recorded again the barnacle regrows at once, with its words.
test('scrub removes one barnacle, or all, and never mutates the list it is given', () => {
  const copy = B.map(b => ({ ...b }))
  expect(scrub(B, 'a.ts')).toEqual([B[1]])
  expect(scrub(B, 'none')).toEqual(B)
  expect(scrub(B, null)).toEqual([])
  expect(B).toEqual(copy)
  expect(scrub(B, 'a.ts')[0]).not.toBe(B[1])
})

test('stampScrub records the scrub time and the words per barnacle without touching the record it is given', () => {
  const before = { 'a.ts': { at: 5, text: 'old' } }
  const after = stampScrub(before, B, 50)
  expect(after).toEqual({
    'a.ts': { at: 50, text: 'a.ts keeps needing a third edit.' },
    'b.ts': { at: 50, text: 'b.ts keeps needing a third edit.' },
  })
  expect(before).toEqual({ 'a.ts': { at: 5, text: 'old' } })
  expect(stampScrub({}, [], 9)).toEqual({})
})

test("afterScrub forgets a key's friction at or before its scrub, and keeps the rest", () => {
  const log = [f('a.ts', 100), f('a.ts', 200), f('b.ts', 150), f('a.ts', 300)]
  expect(afterScrub(log, { 'a.ts': { at: 200, text: '' } })).toEqual([f('b.ts', 150), f('a.ts', 300)])
  expect(afterScrub(log, {})).toEqual(log)
  expect(afterScrub(log, { 'a.ts': { at: 1_000, text: '' }, 'b.ts': { at: 1_000, text: '' } })).toEqual([])
})

test('regrown gives the scrubbed barnacle back, unspoken, on friction after the scrub only', () => {
  const scrubbed = stampScrub({}, [B[0]!], 200)
  expect(regrown(scrubbed, f('a.ts', 201))).toEqual({ key: 'a.ts', text: 'a.ts keeps needing a third edit.', spoken: false })
  expect(regrown(scrubbed, f('a.ts', 200))).toBeNull()
  expect(regrown(scrubbed, f('a.ts', 150))).toBeNull()
  expect(regrown(scrubbed, f('b.ts', 300))).toBeNull()
  // A scrub stored without words (the first cut's shape) regrows with the friction's own detail.
  expect(regrown({ 'c.ts': { at: 1, text: '' } }, f('c.ts', 2))).toEqual({
    key: 'c.ts',
    text: 'c.ts failed twice in a row, again after a scrub.',
    spoken: false,
  })
})

// Bradley, 2026-10-09: edits to a file under build are the work, not friction.
test('realFriction drops the retired third-edit entries and keeps every other kind', () => {
  const log: Friction[] = [
    { kind: 're-edit', key: 'c:/x/a.ts', at: 1, detail: 'third edit of c:/x/a.ts' },
    { kind: 'cancelled-write', key: 'mcp__sb__execute_sql', at: 2, detail: 'write cancelled at the prompt' },
    { kind: 'tool-failure', key: 'Bash', at: 3, detail: 'Bash failed twice in a row' },
    { kind: 'let-through', key: 'mcp__sb__execute_sql', at: 4, detail: 'let through once' },
  ]
  expect(realFriction(log).map(x => x.kind)).toEqual(['cancelled-write', 'tool-failure', 'let-through'])
  expect(log.length).toEqual(4)
})

test('unscrub lifts one scrub and leaves the others, never mutating', () => {
  const scrubbed = stampScrub({}, B, 10)
  const lifted = unscrub(scrubbed, 'a.ts')
  expect(Object.keys(lifted)).toEqual(['b.ts'])
  expect(Object.keys(scrubbed).sort()).toEqual(['a.ts', 'b.ts'])
  expect(unscrub(lifted, 'none')).toEqual(lifted)
})

test('asScrubbed reads a stored record, takes a bare number as a scrub with no words, and ignores the rest', () => {
  expect(asScrubbed({ 'a.ts': { at: 5, text: 'words' }, 'b.ts': 7, 'c.ts': 'soon', d: null, 'e.ts': { text: 'x' } })).toEqual({
    'a.ts': { at: 5, text: 'words' },
    'b.ts': { at: 7, text: '' },
  })
  expect(asScrubbed(null)).toEqual({})
  expect(asScrubbed([1, 2])).toEqual({})
  expect(asScrubbed('x')).toEqual({})
})
