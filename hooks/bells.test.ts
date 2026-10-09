import { test, expect } from 'claude-code/testing'
import { BELLS, BELL_MS, BREAK_MS, HALF_BELL_MS, MAX_HALVES, bellHalves, bellsRung, isIdle, touch } from './bells'

const MIN = 60_000

test('constants: a half bell is thirty minutes, a bell an hour, three bells on the chime', () => {
  expect(BREAK_MS).toEqual(5 * MIN)
  expect(HALF_BELL_MS).toEqual(30 * MIN)
  expect(BELL_MS).toEqual(60 * MIN)
  expect(BELLS).toEqual(3)
  expect(MAX_HALVES).toEqual(6)
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

test('bellHalves is one per thirty active minutes, capped at six; bellsRung the whole hours, capped at three', () => {
  expect(bellHalves({ activeMs: 0, lastAt: null })).toEqual(0)
  expect(bellHalves({ activeMs: HALF_BELL_MS - 1, lastAt: 0 })).toEqual(0)
  expect(bellHalves({ activeMs: HALF_BELL_MS, lastAt: 0 })).toEqual(1)
  expect(bellHalves({ activeMs: 3 * HALF_BELL_MS + 5, lastAt: 0 })).toEqual(3)
  expect(bellHalves({ activeMs: 6 * HALF_BELL_MS, lastAt: 0 })).toEqual(6)
  expect(bellHalves({ activeMs: 40 * HALF_BELL_MS, lastAt: 0 })).toEqual(6)
  expect(bellsRung({ activeMs: 3 * HALF_BELL_MS, lastAt: 0 })).toEqual(1)
  expect(bellsRung({ activeMs: 4 * HALF_BELL_MS, lastAt: 0 })).toEqual(2)
  expect(bellsRung({ activeMs: 40 * HALF_BELL_MS, lastAt: 0 })).toEqual(3)
})

test('isIdle needs a lastAt and more than five minutes since it', () => {
  expect(isIdle({ activeMs: 0, lastAt: null }, 10 * MIN)).toEqual(false)
  expect(isIdle({ activeMs: 0, lastAt: 0 }, 5 * MIN)).toEqual(false)
  expect(isIdle({ activeMs: 0, lastAt: 0 }, 5 * MIN + 1)).toEqual(true)
})
