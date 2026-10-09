import { test, expect } from 'claude-code/testing'

import {
  EMPTY_QUEUE,
  countText,
  dismiss,
  dismissable,
  enqueue,
  footerRow,
  footerText,
  remove,
  settle,
  showing,
  wrapLines,
} from './notices'
import type { NoticeInput } from './notices'

const own = (text: string, until: number | null = null): NoticeInput => ({ kind: 'own', header: 'SAY', text, full: false, until })
const held: NoticeInput = { kind: 'held', header: 'HELD', text: 'held write', full: true, until: null }
const guest: NoticeInput = { kind: 'guest', header: 'GUEST', text: 'a guest', full: false, until: null }

test('several arriving in one turn are all kept, ordered by priority then arrival', () => {
  let q = enqueue(EMPTY_QUEUE, guest, 'g', 100)
  q = enqueue(q, own('first'), 'o1', 100)
  q = enqueue(q, own('second'), 'o2', 101)
  q = enqueue(q, held, 'h', 102)
  expect(q.items.map(n => n.id)).toEqual(['h', 'o1', 'o2', 'g'])
  const s = showing(q, false, 103)
  expect(s.notice?.id).toBe('h')
  expect([s.n, s.m]).toEqual([1, 4])
})

test('a note from beneath outranks the witness own speech, is counted, never queued', () => {
  const q = enqueue(EMPTY_QUEUE, own('mine'), 'o', 1)
  const s = showing(q, true, 2)
  expect(s.notice).toBeNull()
  expect(s.beneath).toBe(true)
  expect([s.n, s.m]).toEqual([1, 2])
  // A held write still outranks it.
  expect(showing(enqueue(q, held, 'h', 3), true, 4).notice?.id).toBe('h')
})

test('a text already waiting is not added twice; its expiry is refreshed', () => {
  let q = enqueue(EMPTY_QUEUE, own('same', 50), 'a', 1)
  q = enqueue(q, own('same', 90), 'b', 2)
  expect(q.items.length).toBe(1)
  expect(q.items[0]?.id).toBe('a')
  expect(q.items[0]?.until).toBe(90)
})

test('dismiss advances to the next and the count moves on: 1/3, 2/3, 3/3', () => {
  let q = enqueue(EMPTY_QUEUE, own('one'), 'a', 1)
  q = enqueue(q, own('two'), 'b', 2)
  q = enqueue(q, own('three'), 'c', 3)
  expect(countText(showing(q, false, 4).n, showing(q, false, 4).m)).toBe('<1/3>')
  q = dismiss(q, false, 5)
  const s2 = showing(q, false, 5)
  expect(s2.notice?.id).toBe('b')
  expect(countText(s2.n, s2.m)).toBe('<2/3>')
  q = dismiss(q, false, 6)
  const s3 = showing(q, false, 6)
  expect(countText(s3.n, s3.m)).toBe('<3/3>')
  q = dismiss(q, false, 7)
  expect(q).toEqual(EMPTY_QUEUE)
  expect(showing(q, false, 7)).toEqual({ notice: null, beneath: false, n: 0, m: 0 })
})

test('a held write cannot be dismissed, only answered (removed by id)', () => {
  let q = enqueue(EMPTY_QUEUE, held, 'h', 1)
  q = enqueue(q, own('after'), 'o', 2)
  expect(dismissable(showing(q, false, 3).notice)).toBe(false)
  expect(dismiss(q, false, 3).items.map(n => n.id)).toEqual(['h', 'o'])
  const answered = remove(q, 'h')
  expect(showing(answered, false, 4).notice?.id).toBe('o')
  expect(countText(showing(answered, false, 4).n, showing(answered, false, 4).m)).toBe('<2/2>')
})

test('dismiss leaves the note from beneath to its own controls', () => {
  const q = enqueue(EMPTY_QUEUE, own('mine'), 'o', 1)
  expect(dismiss(q, true, 2).items.map(n => n.id)).toEqual(['o'])
})

test('a single notice shows no <n/m>; the footer reads 0: Dismiss alone', () => {
  const q = enqueue(EMPTY_QUEUE, own('only'), 'o', 1)
  const s = showing(q, false, 2)
  expect([s.n, s.m]).toEqual([1, 1])
  expect(countText(s.n, s.m)).toBe('')
  expect(footerText(true, s.n, s.m)).toBe('0: Dismiss')
  expect(footerText(true, 2, 3)).toBe('0: Dismiss <2/3>')
  expect(footerText(false, 1, 2)).toBe('<1/2>')
  expect(footerText(false, 1, 1)).toBe('')
})

test('expired notices count as seen, and an emptied queue starts its count again', () => {
  let q = enqueue(EMPTY_QUEUE, own('short', 10), 'a', 1)
  q = enqueue(q, own('long', 100), 'b', 2)
  const before = showing(q, false, 20)
  expect(before.notice?.id).toBe('b')
  expect([before.n, before.m]).toEqual([2, 2])
  q = settle(q, 20)
  expect([showing(q, false, 20).n, showing(q, false, 20).m]).toEqual([2, 2])
  expect(settle(q, 200)).toEqual(EMPTY_QUEUE)
})

test('the footer sits on the last text row when it fits, else on the header row', () => {
  expect(wrapLines('one two three', 7)).toEqual(['one two', 'three'])
  expect(wrapLines('', 7)).toEqual([''])
  expect(footerRow(['short'], 20, '0: Dismiss')).toBe('last')
  expect(footerRow(['a line that fills it'], 20, '0: Dismiss')).toBe('header')
  expect(footerRow(['anything'], 5, '')).toBe('last')
})

test('enqueue never mutates the queue it is given', () => {
  const q = enqueue(EMPTY_QUEUE, own('x'), 'a', 1)
  const copy = JSON.parse(JSON.stringify(q))
  enqueue(q, own('y'), 'b', 2)
  dismiss(q, false, 3)
  expect(q).toEqual(copy)
})
