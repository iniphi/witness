import { test, expect } from 'claude-code/testing'
import { BELL_MS, BREAK_MS, bellsRung, isIdle, touch } from './bells'

const MIN = 60_000

test('constants', () => {
  expect(BREAK_MS).toEqual(5 * MIN)
  expect(BELL_MS).toEqual(30 * MIN)
})

test('the first touch counts nothing and sets lastAt', () => {
  expect(touch({ activeMs: 0, lastAt: null }, 1000)).toEqual({ activeMs: 0, lastAt: 1000 })
})

test('a gap of five minutes or less is counted, a longer one is not', () => {
  const a = touch({ activeMs: 10, lastAt: 0 }, 2 * MIN)
  expect(a).toEqual({ activeMs: 10 + 2 * MIN, lastAt: 2 * MIN })
  expect(touch({ activeMs: 0, lastAt: 0 }, 5 * MIN).activeMs).toEqual(5 * MIN)
  expect(touch({ activeMs: 0, lastAt: 0 }, 5 * MIN + 1)).toEqual({ activeMs: 0, lastAt: 5 * MIN + 1 })
  expect(touch({ activeMs: 7, lastAt: 0 }, 20 * MIN).activeMs).toEqual(7)
})

test('touch does not mutate its argument', () => {
  const a = { activeMs: 5, lastAt: 0 }
  touch(a, MIN)
  expect(a).toEqual({ activeMs: 5, lastAt: 0 })
})

test('bellsRung is one per thirty active minutes, capped at four', () => {
  expect(bellsRung({ activeMs: 0, lastAt: null })).toEqual(0)
  expect(bellsRung({ activeMs: BELL_MS - 1, lastAt: 0 })).toEqual(0)
  expect(bellsRung({ activeMs: BELL_MS, lastAt: 0 })).toEqual(1)
  expect(bellsRung({ activeMs: 3 * BELL_MS + 5, lastAt: 0 })).toEqual(3)
  expect(bellsRung({ activeMs: 4 * BELL_MS, lastAt: 0 })).toEqual(4)
  expect(bellsRung({ activeMs: 40 * BELL_MS, lastAt: 0 })).toEqual(4)
})

test('isIdle needs a lastAt and more than five minutes since it', () => {
  expect(isIdle({ activeMs: 0, lastAt: null }, 10 * MIN)).toEqual(false)
  expect(isIdle({ activeMs: 0, lastAt: 0 }, 5 * MIN)).toEqual(false)
  expect(isIdle({ activeMs: 0, lastAt: 0 }, 5 * MIN + 1)).toEqual(true)
})
