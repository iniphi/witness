import { test, expect } from 'claude-code/testing'
import { USAGE_ROWS_CAP, addUsage, turnRow, usageFile, usagePath, usageRow } from './usage'

const USAGE = { input_tokens: 812, output_tokens: 14, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 }

test('a usage row takes the call\'s own counts, never an estimate', () => {
  const row = usageRow('extract', 1_000, { isAnswered: true, text: 'x', usage: USAGE })
  expect(row).toEqual({ at: 1_000, pass: 'extract', ok: true, in: 812, out: 14, cacheRead: 3, cacheWrite: 0 })
})

test('an unanswered call is recorded as not ok, with zero tokens', () => {
  const row = usageRow('match', 2_000, { isAnswered: false, reason: 'api-error', status: 529 })
  expect(row).toEqual({ at: 2_000, pass: 'match', ok: false, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
})

test('the usage file is one per session, filed under the day the session started (UTC)', () => {
  const started = Date.UTC(2026, 9, 8, 23, 30)
  expect(usagePath('C:/u', started, 'sess-1')).toEqual('C:/u/2026-10-08/sess-1.json')
  expect(usagePath('C:/u', started, 'a/b\\c:d')).toEqual('C:/u/2026-10-08/a_b_c_d.json')
})

test('the rows are capped, newest kept, so a long session cannot grow the file without bound', () => {
  const many = Array.from({ length: USAGE_ROWS_CAP + 5 }, (_, i) => usageRow('extract', i, null))
  const kept = many.reduce((log, row) => addUsage(log, row), [] as ReturnType<typeof usageRow>[])
  expect(kept.length).toEqual(USAGE_ROWS_CAP)
  expect(kept[0]?.at).toEqual(5)
})

test('a turn row takes the turn\'s own usage and the model that answered it', () => {
  const row = turnRow('tackle', 3_000, { ...USAGE, model: 'claude-opus-5-5' })
  expect(row).toEqual({
    at: 3_000, pass: 'tackle', ok: true, in: 812, out: 14, cacheRead: 3, cacheWrite: 0, model: 'claude-opus-5-5',
  })
})

test('a turn with no usage (an interrupt, an API error) records nothing', () => {
  expect(turnRow('turn', 4_000, undefined)).toBeNull()
})

test('the file carries the session, the repo and the model alias with its rows', () => {
  const rows = [usageRow('extract', 1, { isAnswered: true, text: '', usage: USAGE })]
  const parsed = JSON.parse(usageFile({ sessionId: 's', repo: 'c:/r', startedAt: 7, model: 'haiku', rows }))
  expect([parsed.version, parsed.sessionId, parsed.repo, parsed.startedAt, parsed.model, parsed.rows.length]).toEqual([
    1, 's', 'c:/r', 7, 'haiku', 1,
  ])
})
