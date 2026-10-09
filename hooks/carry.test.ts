import { test, expect } from 'claude-code/testing'
import type { Ask } from '../types'
import { CARRY_STALE_MS, asCarrySlot, carryPrefix, carrySlot, carrySlotKey, mergeCarried, takeable } from './carry'

// Carry-over per session (Bradley, 2026-10-09): a starting session takes only the leftovers of
// sessions that have ended; a live session's undone asks are never taken or overwritten.

const ask = (id: string, text: string): Ask => ({ id, text, source: 'ask', state: 'open', claimId: null, at: 1 })

test('each session has its own slot under the project', () => {
  expect(carryPrefix('c:/w/p')).toBe('carry:c:/w/p:')
  expect(carrySlotKey('c:/w/p', 's1')).toBe('carry:c:/w/p:s1')
})

test('a slot round-trips, and anything else (the old bare list, junk) is not a slot', () => {
  const slot = carrySlot({ sessionId: 's1', savedAt: 5, ended: true, asks: [ask('a', 'Fix the walker')] })
  expect(asCarrySlot(JSON.parse(JSON.stringify(slot)))).toEqual(slot)
  expect(asCarrySlot([ask('a', 'x')])).toBeNull()
  expect(asCarrySlot({ v: 1, sessionId: 's', savedAt: 1, ended: true, asks: [] })).toBeNull()
  expect(asCarrySlot({ v: 2, sessionId: 's', savedAt: 'x', ended: true, asks: [] })).toBeNull()
  expect(asCarrySlot(null)).toBeNull()
})

test('only an ended or stale slot of another session is takeable; a live one never', () => {
  const now = 10 * CARRY_STALE_MS
  const live = carrySlot({ sessionId: 'other', savedAt: now - 60_000, ended: false, asks: [] })
  const ended = carrySlot({ sessionId: 'other', savedAt: now - 60_000, ended: true, asks: [] })
  const stale = carrySlot({ sessionId: 'other', savedAt: now - CARRY_STALE_MS - 1, ended: false, asks: [] })
  const mine = carrySlot({ sessionId: 'me', savedAt: 0, ended: true, asks: [] })
  expect([takeable(live, now, 'me'), takeable(ended, now, 'me'), takeable(stale, now, 'me'), takeable(mine, now, 'me')]).toEqual([
    false,
    true,
    true,
    false,
  ])
})

test('several ended sessions merge, the same ask once, nothing mutated', () => {
  const a = Object.freeze([Object.freeze(ask('a', 'Fix the walker')), Object.freeze(ask('b', 'Ship it'))]) as readonly Ask[]
  const b = [ask('c', 'fix the walker.'), ask('d', 'Write the docs')]
  expect(mergeCarried([a, b]).map(x => x.id)).toEqual(['a', 'b', 'd'])
  expect(mergeCarried([])).toEqual([])
})
