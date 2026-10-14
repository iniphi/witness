import { test, expect } from 'claude-code/testing'
import { INKS } from './body'
import {
  BLUSH_FLIGHT_MS,
  BLUSH_MS,
  LAMP_MS,
  blushFor,
  blushLanded,
  blushLevel,
  blushLive,
  blushText,
  haemorrhageFrom,
  haemorrhageLive,
  haemorrhageNotice,
  lampLive,
} from './blush'
import { readConfig } from './config'
import { rowInks } from './render'
import { REFUSAL_MS, REFUSAL_RED_MS, refusalFrom } from './refusal'
import { BLUSH_PARTS, FRAMES, barnacleCellsOf, bellCellsOf, blushCellsOf, eyeCellsOf, GRIP, CORNERS } from './sprites'
import { buildView } from './view'
import type { Body } from '../types'

const BODIES: Body[] = ['phi', 'phial']
const wrap = (rows: unknown[]): string => `<untrusted-data-abc>\n${JSON.stringify(rows)}\n</untrusted-data-abc>`
const rowsOf = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ id: i }))
const key = ([r, c]: [number, number]): string => `${r},${c}`

test('every blush cell is a non-space glyph in all three frames, and the rungs grow rim, walls, top', () => {
  for (const body of BODIES) {
    const all = blushCellsOf(body, 'compact', 3)
    for (let f = 0; f < 3; f++) {
      const rows = FRAMES[body].compact[f]!.map((r) => Array.from(r))
      for (const [r, c] of all) expect(rows[r]![c]).not.toEqual(' ')
    }
    const n = [1, 2, 3].map((k) => blushCellsOf(body, 'compact', k).length)
    expect(n[0]).toBeGreaterThan(0)
    expect(n[1]).toBeGreaterThan(n[0]!)
    expect(n[2]).toBeGreaterThan(n[1]!)
    expect(BLUSH_PARTS[1]).toEqual(['rim'])
    expect(BLUSH_PARTS[3]).toEqual(['rim', 'walls', 'top'])
    expect(blushCellsOf(body, 'compact', 0)).toEqual([])
    expect(new Set(all.map(key)).size).toEqual(all.length)
  }
})

test('Naut: the rim is row 4, the walls its side strokes, the top row 0; the coil is never blushed', () => {
  const rim = blushCellsOf('phi', 'compact', 1)
  expect(rim.every(([r]) => r === 4)).toBe(true)
  expect(rim.map(([, c]) => c)).toEqual([4, 5, 6, 7, 8])
  const walls = blushCellsOf('phi', 'compact', 2).filter(([r]) => r !== 4)
  expect(walls.map(key)).toEqual(['1,3', '1,9', '2,2', '3,3', '3,9'])
  const top = blushCellsOf('phi', 'compact', 3).filter(([r]) => r === 0)
  expect(top.map(([, c]) => c)).toEqual([3, 4, 5, 6, 7, 8])
  // The coil `( @ )` and the inner arch `.-.` / `` `-' `` are the creature itself.
  const coil = ['2,4', '2,6', '2,8', '1,5', '1,6', '1,7', '3,5', '3,6', '3,7']
  const lit = new Set(blushCellsOf('phi', 'compact', 3).map(key))
  for (const c of coil) expect(lit.has(c)).toBe(false)
})

test('no blush cell is a barnacle or gem cell, a bell, an eye, the grip or a horn corner', () => {
  for (const body of BODIES) {
    const taken = new Set<string>(barnacleCellsOf(body, 'compact', 4).map(key))
    for (let f = 0; f < 3; f++) {
      const rows = FRAMES[body].compact[f]!
      bellCellsOf(rows, body, 'compact').forEach((c) => taken.add(key(c)))
      eyeCellsOf(rows, body, 'compact').forEach((c) => taken.add(key(c)))
    }
    if (body === 'phi') [GRIP, ...CORNERS].forEach((c) => taken.add(key(c)))
    for (const c of blushCellsOf(body, 'compact', 3)) {
      if (body === 'phi' && CORNERS.some((k) => key(k) === key(c))) continue
      expect(taken.has(key(c))).toBe(false)
    }
  }
})

const base = {
  body: 'phi' as const,
  frameIndex: 0,
  ledger: { writes: [], claims: [], turns: {} },
  asks: [],
  activity: { activeMs: 0, lastAt: null },
  now: 100,
  speech: null,
  hold: null,
  barnacles: [],
  working: false,
  rowsLanded: false,
  maxRows: 0,
  bodyColumns: 120,
}
const undo = { rung: 2 as const, what: 'git push', undo: 'a revert commit undoes the code' }

test('the blush text names the rung in words, the call and the undo', () => {
  expect(blushText({ ...undo, rung: 1 })).toEqual('you can undo it: git push - a revert commit undoes the code')
  expect(blushText(undo).startsWith("undo won't get it all back: ")).toBe(true)
  expect(blushText({ ...undo, rung: 3 }).startsWith('nobody can undo it: ')).toBe(true)
})

test('a blush lights for the flight, then the floor runs from the result', () => {
  const b = blushFor(undo, 1000, 'b1')
  expect(b.until).toEqual(1000 + BLUSH_FLIGHT_MS)
  expect(b.noticeId).toEqual('b1')
  const landed = blushLanded(b, 1200)
  expect(landed.until).toEqual(1200 + BLUSH_MS)
  expect(BLUSH_MS).toEqual(4000)
  expect(blushLive(landed, 1200 + BLUSH_MS - 1)).toBe(true)
  expect(blushLive(landed, 1200 + BLUSH_MS)).toBe(false)
  expect(blushLive(null, 0)).toBe(false)
})

test('the view blushes the cells of the rung, as drawn, and facing left mirrors them', () => {
  const b = blushFor({ ...undo, rung: 3 }, 100, 'b')
  const v = buildView({ ...base, blush: b })
  expect(v.safelight).toBe(false)
  expect(v.blush.map(key).sort()).toEqual(blushCellsOf('phi', 'compact', 3).map(key).sort())
  const left = buildView({ ...base, blush: b, facing: 'left' })
  const width = Array.from(left.sprite[0]!).length
  expect(left.blush.map(key).sort()).toEqual(blushCellsOf('phi', 'compact', 3).map(([r, c]) => key([r, width - 1 - c])).sort())
  expect(buildView({ ...base }).blush).toEqual([])
  expect(buildView({ ...base, now: b.until + 1, blush: b }).blush).toEqual([])
})

test('amber below red (1.10.0): rung 1 inks in the theme warning colour, rungs 2 and 3 in error red, by key, never hex', () => {
  const v = buildView({ ...base, blush: blushFor({ ...undo, rung: 1 }, 100, 'b') })
  expect(INKS.blush).toEqual('error')
  expect(INKS.blushAmber).toEqual('warning')
  expect(blushLevel(1)).toEqual('amber')
  expect(blushLevel(2)).toEqual('red')
  expect(v.blushLevel).toEqual('amber')
  const row4 = rowInks(v, 4, false)
  expect(row4.map((s) => s.col)).toEqual([4, 5, 6, 7, 8])
  expect(row4.every((s) => s.color === 'warning')).toBe(true)
  expect(rowInks(v, 2, false).filter((s) => s.color === 'warning' || s.color === 'error')).toEqual([])
  const red = buildView({ ...base, blush: blushFor({ ...undo, rung: 2 }, 100, 'b') })
  expect(red.blushLevel).toEqual('red')
  expect(rowInks(red, 4, false).every((s) => s.color === 'error')).toBe(true)
})

test('a refusal is whole-creature red for 10 s, then the rim stays amber until it lapses; a redder blush keeps its own cells', () => {
  const refusal = refusalFrom(
    { tool: 'mcp__x__execute_sql', query: 'delete from t where id = 1', resultText: 'PreToolUse:x hook error: [python g.py]: no', isError: true, denied: false, agent: false },
    1000,
    'r',
  )!
  const red = buildView({ ...base, now: 1000 + REFUSAL_RED_MS - 1, refusal })
  expect(red.safelight).toBe(true)
  expect(red.blush).toEqual([])
  const amber = buildView({ ...base, now: 1000 + REFUSAL_RED_MS, refusal })
  expect(amber.safelight).toBe(false)
  expect(amber.blushLevel).toEqual('amber')
  expect(amber.blush.map(key).sort()).toEqual(blushCellsOf('phi', 'compact', 1).map(key).sort())
  expect(amber.status).toContain('REFUSED')
  expect(buildView({ ...base, now: 1000 + REFUSAL_MS, refusal }).blush).toEqual([])
  const b3 = blushFor({ ...undo, rung: 3 }, 1000 + REFUSAL_RED_MS, 'b')
  const both = buildView({ ...base, now: 1000 + REFUSAL_RED_MS, refusal, blush: b3 })
  expect(both.blushLevel).toEqual('red')
  expect(both.blush.map(key).sort()).toEqual(blushCellsOf('phi', 'compact', 3).map(key).sort())
})

test('the hold, a refusal, a haemorrhage and the lamp test each win over a blush: the whole creature, no partial cells', () => {
  const b = blushFor({ ...undo, rung: 3 }, 100, 'b')
  const hold = { toolUseId: 't', sql: 'delete from t', fixed: null, at: 1 }
  expect(buildView({ ...base, blush: b, hold })).toMatchObject({ safelight: true, blush: [] })
  const refusal = refusalFrom(
    { tool: 'mcp__x__execute_sql', query: 'delete from t where id = 1', resultText: 'PreToolUse:x hook error: [python g.py]: no', isError: true, denied: false, agent: false },
    100,
    'r',
  )!
  expect(buildView({ ...base, blush: b, refusal })).toMatchObject({ safelight: true, blush: [] })
  const bleed = haemorrhageFrom({ query: 'update t set a = 1 returning id', resultText: wrap(rowsOf(30)), threshold: 25 }, 100, 'h')!
  expect(buildView({ ...base, blush: b, haemorrhage: bleed })).toMatchObject({ safelight: true, blush: [] })
  expect(buildView({ ...base, blush: b, lamp: 100 + LAMP_MS })).toMatchObject({ safelight: true, blush: [] })
  expect(buildView({ ...base, blush: b, lamp: 100 })).toMatchObject({ safelight: false })
})

test('the lamp test is live until its end and shows no bubble of its own', () => {
  expect(lampLive(1500, 1499)).toBe(true)
  expect(lampLive(1500, 1500)).toBe(false)
  expect(lampLive(null, 0)).toBe(false)
  expect(LAMP_MS).toEqual(1500)
  expect(buildView({ ...base, lamp: 100 + LAMP_MS }).bubble).toBeNull()
})

test('haemorrhage: 675 rows from a statement that named 1 is red', () => {
  const h = haemorrhageFrom(
    { query: "update workspace.router_inbox set status = 'x' where id = 'a' returning id", resultText: wrap(rowsOf(675)), threshold: 25 },
    1000,
    'h1',
  )!
  expect(h).toMatchObject({ rows: 675, named: 1, table: 'workspace.router_inbox', until: 1000 + REFUSAL_MS })
  expect(haemorrhageNotice(h)).toEqual({
    header: 'HAEMORRHAGE',
    text: '675 rows came back from a statement that named 1 (workspace.router_inbox). The witness did not hold it; check what it touched.',
  })
  expect(haemorrhageLive(h, 1000 + REFUSAL_MS - 1)).toBe(true)
  expect(haemorrhageLive(h, 1000 + REFUSAL_MS)).toBe(false)
})

test('haemorrhage: rows within what an IN list named are not; 30 from a bare-WHERE UPDATE over a threshold of 25 are', () => {
  const inList = "update t set a = 1 where id in ('a','b','c') returning id"
  expect(haemorrhageFrom({ query: inList, resultText: wrap(rowsOf(3)), threshold: 1 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: inList, resultText: wrap(rowsOf(4)), threshold: 1 }, 0, 'h')).not.toBeNull()
  const bare = "update t set a = 1 where status = 'x' returning id"
  expect(haemorrhageFrom({ query: bare, resultText: wrap(rowsOf(30)), threshold: 25 }, 0, 'h')?.rows).toEqual(30)
  expect(haemorrhageFrom({ query: bare, resultText: wrap(rowsOf(25)), threshold: 25 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: bare, resultText: wrap(rowsOf(26)), threshold: 25 }, 0, 'h')).not.toBeNull()
})

test('haemorrhage: no RETURNING, an unreadable result or a SELECT is never one', () => {
  expect(haemorrhageFrom({ query: 'update t set a = 1', resultText: wrap(rowsOf(300)), threshold: 25 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: 'update t set a = 1 returning id', resultText: 'ERROR: boom', threshold: 25 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: 'update t set a = 1 returning id', resultText: '{"status":"cancelled"}', threshold: 25 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: 'select * from t', resultText: wrap(rowsOf(300)), threshold: 25 }, 0, 'h')).toBeNull()
  expect(haemorrhageFrom({ query: 'update t set a = 1 returning id', resultText: '', threshold: 25 }, 0, 'h')).toBeNull()
})

test('the view says HAEMORRHAGE in the status while one is live, and goes red', () => {
  const h = haemorrhageFrom({ query: 'delete from t returning id', resultText: wrap(rowsOf(40)), threshold: 25 }, 100, 'h')!
  const v = buildView({ ...base, haemorrhage: h })
  expect(v.safelight).toBe(true)
  expect(v.status).toContain('HAEMORRHAGE')
  expect(buildView({ ...base, now: h.until + 1, haemorrhage: h }).safelight).toBe(false)
})

test('config: the four 1.7 options and effectTables, neutral by default', () => {
  const d = readConfig(undefined)
  expect([d.pointInTimeRecovery, d.haemorrhageRows, d.lampTest, d.effectTables]).toEqual([false, 25, true, []])
  const c = readConfig({ pointInTimeRecovery: true, haemorrhageRows: '40', lampTest: false, effectTables: 'a.b, c.*' })
  expect([c.pointInTimeRecovery, c.haemorrhageRows, c.lampTest, c.effectTables]).toEqual([true, 40, false, ['a.b', 'c.*']])
  expect(readConfig({ haemorrhageRows: 0 }).haemorrhageRows).toEqual(25)
  expect(readConfig({ haemorrhageRows: 'many', pointInTimeRecovery: 'maybe' }).haemorrhageRows).toEqual(25)
  expect(readConfig({ haemorrhageRows: 12 }).haemorrhageRows).toEqual(12)
})
