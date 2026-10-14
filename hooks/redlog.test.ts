import { test, expect } from 'claude-code/testing'

import {
  FIX,
  REDS_PER_SLOT,
  REDS_KEEP_MS,
  REDS_SHOWN,
  asRedSlot,
  closeRed,
  openRed,
  redSlot,
  redsList,
  redsPrefix,
  redsSlotKey,
  redsSection,
  redsStale,
  redsSummary,
} from './redlog'
import type { RedEvent, RedSlot } from './redlog'

// The red log (1.10.0, Bradley 2026-10-11): "are we tracking and logging when the safelight comes
// on, why it comes on and what the fix is?" Every safelight event: when, channel, level, why, fix,
// and how it ended. Pure.

const ev = (o: Partial<RedEvent> & Pick<RedEvent, 'channel' | 'level'>): RedEvent => ({
  id: `${o.channel}${o.at ?? 1000}`,
  at: 1000,
  why: 'why',
  fix: 'fix',
  ...o,
})

test('openRed adds an open event with an id and caps the why', () => {
  const out = openRed([], { channel: 'refusal', level: 'red', why: 'x'.repeat(300), fix: FIX.refusal, at: 5000 })
  expect(out.length).toEqual(1)
  expect(out[0]!.why.length <= 140).toBe(true)
  expect(out[0]!.endedAt).toBeUndefined()
  expect(out[0]!.id).toContain('refusal')
})

test('openRed is bounded: the oldest fall off past the per-slot cap', () => {
  let events: RedEvent[] = []
  for (let i = 0; i < REDS_PER_SLOT + 5; i++) events = openRed(events, { channel: 'blush', level: 'amber', rung: 1, why: `w${i}`, fix: 'f', at: i })
  expect(events.length).toEqual(REDS_PER_SLOT)
  expect(events[0]!.why).toEqual('w5')
})

test('closeRed ends every open event of a channel and leaves the others and the closed', () => {
  const a = ev({ channel: 'refusal', level: 'red', at: 1 })
  const b = ev({ channel: 'blush', level: 'amber', at: 2 })
  const c = { ...ev({ channel: 'refusal', level: 'red', at: 3 }), endedAt: 4, how: 'lapsed' as const }
  const out = closeRed([a, b, c], { channel: 'refusal' }, 'cleared', 99)
  expect(out[0]!.how).toEqual('cleared')
  expect(out[0]!.endedAt).toEqual(99)
  expect(out[1]!.how).toBeUndefined()
  expect(out[2]!.how).toEqual('lapsed')
  expect(out[2]!.endedAt).toEqual(4)
})

test('closeRed by id ends only that event', () => {
  const a = ev({ channel: 'blush', level: 'amber', at: 1 })
  const b = ev({ channel: 'blush', level: 'amber', at: 2 })
  const out = closeRed([a, b], { id: b.id }, 'failed', 9)
  expect(out[0]!.how).toBeUndefined()
  expect(out[1]!.how).toEqual('failed')
})

test('a slot round-trips and drops malformed events and unknown enums', () => {
  const good = ev({ channel: 'hold', level: 'red', at: 10 })
  const slot = redSlot({ sessionId: 'sess-a', savedAt: 50, events: [good] })
  expect(asRedSlot(JSON.parse(JSON.stringify(slot)))).toEqual(slot)
  const dirty = { v: 1, sessionId: 'sess-a', savedAt: 50, events: [good, { ...good, channel: 'nonsense' }, { ...good, level: 'blue' }, 'x', { ...good, how: 'whatever' }] }
  const read = asRedSlot(dirty)!
  expect(read.events.length).toEqual(2)
  expect(read.events[1]!.how).toBeUndefined()
  expect(asRedSlot(null)).toBeNull()
  expect(asRedSlot({ v: 2, sessionId: 'a', savedAt: 1, events: [] })).toBeNull()
})

test('a slot stores only the named fields', () => {
  const dirty = { ...ev({ channel: 'hold', level: 'red' }), sql: 'DELETE FROM t', path: 'C:/x' }
  const slot = redSlot({ sessionId: 's', savedAt: 1, events: [dirty as RedEvent] })
  expect(Object.keys(slot.events[0]!).sort()).toEqual(['at', 'channel', 'fix', 'id', 'level', 'why'])
})

test('keys follow the routines pattern', () => {
  expect(redsPrefix('proj')).toEqual('reds:proj:')
  expect(redsSlotKey('proj', 'abc')).toEqual('reds:proj:abc')
})

test('a slot is stale a week after its save, and never one of this session', () => {
  const slot: RedSlot = { v: 1, sessionId: 'a', savedAt: 1000, events: [] }
  expect(redsStale(slot, 1000 + REDS_KEEP_MS + 1, 'b')).toBe(true)
  expect(redsStale(slot, 1000 + REDS_KEEP_MS - 1, 'b')).toBe(false)
  expect(redsStale(slot, 1000 + REDS_KEEP_MS + 1, 'a')).toBe(false)
})

test('the summary counts by channel and level', () => {
  const events = [
    ev({ channel: 'blush', level: 'amber', rung: 1 }),
    ev({ channel: 'blush', level: 'amber', rung: 1 }),
    ev({ channel: 'blush', level: 'red', rung: 3 }),
    ev({ channel: 'refusal', level: 'red' }),
  ]
  expect(redsSummary(events)).toEqual('4 events: blush 3 (2 amber, 1 red), refusal 1 (1 red)')
  expect(redsSummary([])).toEqual('0 events')
})

test('the print section is empty when there were no red events', () => {
  expect(redsSection([ev({ channel: 'blush', level: 'amber', rung: 1 })])).toEqual([])
  expect(redsSection([])).toEqual([])
})

test('the print section leaves out the lamp test and lists each red event with why, fix and outcome', () => {
  const events = [
    { ...ev({ channel: 'lamp', level: 'red' }), endedAt: 2, how: 'lapsed' as const },
    ev({ channel: 'blush', level: 'amber', rung: 1, at: 1_000 }),
    { ...ev({ channel: 'refusal', level: 'red', at: Date.UTC(2026, 9, 11, 14, 3), why: 'blocked by a guard', fix: FIX.refusal }), endedAt: 5, how: 'cleared' as const },
  ]
  const lines = redsSection(events)
  expect(lines[0]).toEqual('## Safelight')
  const text = lines.join('\n')
  expect(text).toContain('blush 1 (1 amber)')
  expect(text).not.toContain('lamp')
  expect(text).toContain('14:03')
  expect(text).toContain('refusal')
  expect(text).toContain('blocked by a guard')
  expect(text).toContain(FIX.refusal)
  expect(text).toContain('cleared')
})

test('an open red event reads as still showing', () => {
  const lines = redsSection([ev({ channel: 'hold', level: 'red', at: Date.UTC(2026, 9, 11, 9, 0) })])
  expect(lines.join('\n')).toContain('still showing')
})

test('the list is newest first across sessions, at most 20, with session tags and a summary line', () => {
  const slots: RedSlot[] = [
    { v: 1, sessionId: 'sess-a', savedAt: 1, events: Array.from({ length: 15 }, (_, i) => ev({ channel: 'blush', level: 'amber', rung: 1, at: 1000 + i * 2 })) },
    { v: 1, sessionId: 'sess-b', savedAt: 1, events: Array.from({ length: 15 }, (_, i) => ev({ channel: 'refusal', level: 'red', at: 1001 + i * 2 })) },
  ]
  const out = redsList(slots)
  expect(out.length).toEqual(1 + REDS_SHOWN)
  expect(out[0]).toContain('30 events')
  expect(out[0]).toContain('last 20')
  // newest first: the newest is sess-a's? at=1028 vs sess-b 1029 -> sess-b
  expect(out[1]).toContain('refusal')
  expect(out[1]).toMatch(/\[s[0-9a-f]{5}\]/)
  expect(out[2]).toContain('blush')
})

test('the list says so when there are none', () => {
  expect(redsList([])).toEqual(['No safelight events recorded for this project.'])
})

test('FIX texts are the ruled ones', () => {
  expect(FIX.hold).toContain('WITH w AS (<statement> RETURNING *) SELECT * FROM w')
  expect(FIX.haemorrhage).toEqual('the write happened: check what it touched')
  expect(FIX.lamp).toEqual('none: the lamp test proves the red channel works')
})
