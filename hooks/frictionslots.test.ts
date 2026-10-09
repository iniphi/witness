import { test, expect } from 'claude-code/testing'
import type { Friction } from '../types'
import { FRICTION_CAP } from './barnacles'
import {
  FRICTION_ARCHIVE_MS,
  archivable,
  asFrictionList,
  asFrictionSlot,
  frictionPrefix,
  frictionSlot,
  frictionSlotKey,
  mergeFriction,
  ownFriction,
} from './frictionslots'

// Friction per session (Bradley, 2026-10-09): each pod writes only its own friction; every pod
// reads them all; a day-old slot is folded into the archive.

const f = (at: number, key = 'Bash', detail = 'd'): Friction => ({ kind: 'tool-failure', key, at, detail })

test('each session has its own friction slot under the project', () => {
  expect(frictionPrefix('c:/w/p')).toBe('friction:c:/w/p:')
  expect(frictionSlotKey('c:/w/p', 's1')).toBe('friction:c:/w/p:s1')
})

test('a slot round-trips, keeps the newest entries, and anything else is not a slot', () => {
  const many = Array.from({ length: FRICTION_CAP + 3 }, (_, i) => f(i))
  const slot = frictionSlot({ sessionId: 's1', savedAt: 9, entries: many })
  expect(slot.entries).toHaveLength(FRICTION_CAP)
  expect(slot.entries[0]!.at).toBe(3)
  expect(asFrictionSlot(JSON.parse(JSON.stringify(slot)))).toEqual(slot)
  expect(asFrictionSlot([f(1)])).toBeNull()
  expect(asFrictionSlot({ v: 2, sessionId: 's', savedAt: 'x', entries: [] })).toBeNull()
  expect(asFrictionList([f(1), { kind: 'x' }, null])).toEqual([f(1)])
  expect(asFrictionList('junk')).toEqual([])
})

test('only another session\'s slot untouched for a day is folded into the archive', () => {
  const now = 10 * FRICTION_ARCHIVE_MS
  const day = frictionSlot({ sessionId: 'old', savedAt: now - FRICTION_ARCHIVE_MS - 1, entries: [] })
  const fresh = frictionSlot({ sessionId: 'new', savedAt: now - 1000, entries: [] })
  const mine = frictionSlot({ sessionId: 'me', savedAt: 0, entries: [] })
  expect([archivable(day, now, 'me'), archivable(fresh, now, 'me'), archivable(mine, now, 'me')]).toEqual([true, false, false])
})

test('several pods\' friction merges oldest first, each entry once, capped; nothing mutated', () => {
  const a = Object.freeze([Object.freeze(f(5, 'A')), Object.freeze(f(1, 'B'))]) as readonly Friction[]
  const b = [f(5, 'A'), f(3, 'C')]
  expect(mergeFriction([a, b]).map(x => `${x.key}${x.at}`)).toEqual(['B1', 'C3', 'A5'])
  const big = Array.from({ length: FRICTION_CAP + 10 }, (_, i) => f(i))
  expect(mergeFriction([big])).toHaveLength(FRICTION_CAP)
  expect(mergeFriction([big])[0]!.at).toBe(10)
})

test('a session writes only the friction it recorded since it started', () => {
  expect(ownFriction([f(1), f(5), f(9)], 5).map(x => x.at)).toEqual([5, 9])
})
