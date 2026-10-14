import { test, expect } from 'claude-code/testing'
import type { Ask, Ledger } from '../types'
import {
  applyMatches,
  applyTriage,
  MAX_PREVIOUS_CHARS,
  PRINT_END,
  carryOver,
  counts,
  dropAsk,
  extractPrompt,
  matchPrompt,
  mergeGoals,
  nm,
  paneRows,
  parseExtract,
  parseExtraction,
  parseGoals,
  parseMatch,
  parseTriage,
  printSection,
  resolveStates,
  seedCarried,
} from './asks'

const LOG = [
  '# Session: 2026-10-07 16:30',
  '',
  '## Scope',
  '- Type: Single project',
  '',
  '## Goals',
  '- [ ] Build the witness companion mod v0.1 (Naut body) from the Notion spec, full v0.1 this session (Bradley\'s ruling) — link: https://www.notion.example/7a6b5c4d3e2f40118293a4b5c6d7e8f9',
  '- [ ] Add the asks ledger to it: a done/undone tracker the watcher holds, n/m in the band, full list on a slash-command pane (Bradley: "so often the to-do list is not tracked anymore")',
  '- [x] Amend the Notion build spec with the asks ledger rulings — https://app.notion.example/p/0f1e2d3c4b5a49687786a5b4c3d2e1f0',
  '',
  '## Progress',
  '- [ ] not a goal',
].join('\n')

const ask = (id: string, text: string, state: Ask['state'] = 'open', extra: Partial<Ask> = {}): Ask => ({
  id,
  text,
  source: 'ask',
  state,
  claimId: null,
  at: 100,
  ...extra,
})

const ledger = (claims: Array<[string, number, 'pale' | 'developed']>): Ledger => ({
  writes: [],
  turns: {},
  claims: claims.map(([id, at, state]) => ({ id, at, state, turnId: 't' + id, text: 'claim ' + id, writeIds: [] })),
})

test('parseGoals reads the real log Goals section only', () => {
  const goals = parseGoals(LOG)
  expect(goals.length).toEqual(3)
  expect(goals.map((g) => g.ticked)).toEqual([false, false, true])
  expect(goals[0]!.text.startsWith('Build the witness companion mod')).toEqual(true)
})

test('parseGoals returns [] with no Goals section', () => {
  expect(parseGoals('# Session\n\n## Scope\n- [ ] x\n')).toEqual([])
  expect(parseGoals('')).toEqual([])
})

test('mergeGoals adds unseen goals, dedupes, and claims ticked ones', () => {
  const goals = parseGoals(LOG)
  const first = mergeGoals([], goals, { at: 5, ids: ['a1', 'a2', 'a3'] })
  expect(first.map((a) => [a.id, a.source, a.state])).toEqual([
    ['a1', 'goal', 'open'],
    ['a2', 'goal', 'open'],
    ['a3', 'goal', 'claimed'],
  ])
  const again = mergeGoals(first, goals, { at: 9, ids: ['b1'] })
  expect(again).toEqual(first)
})

test('mergeGoals claims an existing open ask whose goal is now ticked, without mutating', () => {
  const existing = [ask('x', 'Fix the mirror walk!', 'open')]
  const out = mergeGoals(existing, [{ text: 'fix the mirror walk', ticked: true }], { at: 1, ids: ['n'] })
  expect(out.length).toEqual(1)
  expect(out[0]!.state).toEqual('claimed')
  expect(out[0]!.claimId).toEqual(null)
  expect(existing[0]!.state).toEqual('open')
})

test('extract and match prompts put the fixed text first and the data last', () => {
  const p = extractPrompt('please fix the band', [ask('1', 'add a pane')])
  expect(p.indexOf('Reply with the JSON only.') < p.indexOf('please fix the band')).toEqual(true)
  expect(p.includes('1. add a pane')).toEqual(true)
  expect(p.includes('{"asks":')).toEqual(true)
  const m = matchPrompt([ask('1', 'add a pane'), ask('2', 'fix band')], 'I added the pane.')
  expect(m.includes('2. fix band')).toEqual(true)
  expect(m.includes('{"done":')).toEqual(true)
  expect(m.endsWith('I added the pane.')).toEqual(true)
})

test('parseExtract handles clean, fenced, prose-wrapped and junk replies', () => {
  expect(parseExtract('{"asks": ["fix the band", " add a pane "]}')).toEqual(['fix the band', 'add a pane'])
  expect(parseExtract('```json\n{"asks": ["fix the band"]}\n```')).toEqual(['fix the band'])
  expect(parseExtract('Sure! Here you go: {"asks": ["run tests"]} hope that helps')).toEqual(['run tests'])
  expect(parseExtract('no json here')).toEqual([])
  expect(parseExtract('{"asks": "nope"}')).toEqual([])
  expect(parseExtract('{"asks": [1, null, "ok"]}')).toEqual(['ok'])
  expect(parseExtract('{"asks": ["unterminated')).toEqual([])
  expect(parseExtract('')).toEqual([])
})

test('parseExtract caps at 5, truncates to 90, and drops duplicates of existing asks', () => {
  const many = JSON.stringify({ asks: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] })
  expect(parseExtract(many).length).toEqual(5)
  const long = parseExtract(JSON.stringify({ asks: ['x'.repeat(200)] }))
  expect(long[0]!.length).toEqual(90)
  const out = parseExtract('{"asks": ["Add a pane.", "add a pane", "write tests"]}', [ask('1', 'add a pane')])
  expect(out).toEqual(['write tests'])
})

test('parseMatch drops out-of-range and duplicate numbers', () => {
  expect(parseMatch('{"done": [1, 3]}', 3)).toEqual([1, 3])
  expect(parseMatch('{"done": [0, 1, 1, 4, 2.5, "2", 3]}', 3)).toEqual([1, 3])
  expect(parseMatch('```\n{"done": []}\n```', 3)).toEqual([])
  expect(parseMatch('garbage', 3)).toEqual([])
  expect(parseMatch('{"done": 2}', 3)).toEqual([])
})

test('applyMatches claims open asks only and leaves others', () => {
  const asks = [ask('a', 'one'), ask('b', 'two', 'witnessed', { claimId: 'c0' }), ask('c', 'three', 'dropped'), ask('d', 'four')]
  const out = applyMatches(asks, ['a', 'b', 'c'], 'c1')
  expect(out.map((a) => [a.state, a.claimId])).toEqual([
    ['claimed', 'c1'],
    ['witnessed', 'c0'],
    ['dropped', null],
    ['open', null],
  ])
  expect(asks[0]!.state).toEqual('open')
})

test('resolveStates: developed -> witnessed, pale -> claimed', () => {
  const asks = [ask('a', 'one', 'claimed', { claimId: 'c1' }), ask('b', 'two', 'claimed', { claimId: 'c2' })]
  const out = resolveStates(asks, ledger([['c1', 200, 'developed'], ['c2', 200, 'pale']]))
  expect(out.map((a) => a.state)).toEqual(['witnessed', 'claimed'])
})

test('resolveStates: a ticked goal with no claim of its own stays pale, whatever else is claimed', () => {
  const goal = ask('g', 'Fix the mirror walk', 'claimed', { source: 'goal', at: 100 })
  const out = resolveStates([goal], ledger([['late', 300, 'developed']]))
  expect(out[0]!.state).toEqual('claimed')
  expect(out[0]!.claimId).toEqual(null)
  expect(nm(out)).toEqual('0/1 ~1')
  const own = resolveStates(applyMatches([goal], ['g'], 'late'), ledger([['late', 300, 'developed']]))
  expect(own[0]!.state).toEqual('witnessed')
})

test('resolveStates: witnessed never regresses, dropped untouched', () => {
  const asks = [ask('a', 'one', 'witnessed', { claimId: 'c1' }), ask('b', 'two', 'dropped', { claimId: 'c1' })]
  const out = resolveStates(asks, ledger([['c1', 200, 'pale']]))
  expect(out.map((a) => a.state)).toEqual(['witnessed', 'dropped'])
})

test('counts and nm, including 0/0 and the pale suffix', () => {
  expect(counts([])).toEqual({ done: 0, total: 0, pale: 0, carried: 0, builds: 0 })
  expect(nm([])).toEqual('0/0')
  const asks = [
    ask('a', 'one', 'witnessed'),
    ask('b', 'two', 'claimed'),
    ask('c', 'three'),
    ask('d', 'four', 'dropped'),
  ]
  expect(counts(asks)).toEqual({ done: 1, total: 3, pale: 1, carried: 0, builds: 0 })
  expect(nm(asks)).toEqual('1/3 ~1')
  expect(nm([ask('a', 'one', 'witnessed'), ask('b', 'two')])).toEqual('1/2')
})

test('paneRows orders open, pale, done and omits dropped', () => {
  const asks = [
    ask('w', 'done one', 'witnessed'),
    ask('p', 'pale one', 'claimed'),
    ask('o1', 'open one'),
    ask('x', 'gone', 'dropped'),
    ask('o2', 'open two', 'open', { source: 'goal' }),
  ]
  expect(paneRows(asks).map((r) => [r.id, r.marker, r.source])).toEqual([
    ['o1', '[ ]', 'ask'],
    ['o2', '[ ]', 'goal'],
    ['p', '[~]', 'ask'],
    ['w', '[x]', 'ask'],
  ])
})

test('dropAsk drops one ask without mutating', () => {
  const asks = [ask('a', 'one'), ask('b', 'two')]
  const out = dropAsk(asks, 'a')
  expect(out.map((a) => a.state)).toEqual(['dropped', 'open'])
  expect(asks[0]!.state).toEqual('open')
})

test('carryOver keeps only open asks nobody claimed; seedCarried re-enters them as open carried asks', () => {
  const asks = [
    ask('a', 'one', 'witnessed'),
    ask('b', 'two', 'claimed', { claimId: 'c' }),
    ask('c', 'three'),
    ask('d', 'four', 'dropped'),
    ask('e', 'five', 'open', { source: 'goal' }),
  ]
  const carried = carryOver(asks)
  expect(carried.map((a) => a.id)).toEqual(['c', 'e'])
  const seeded = seedCarried(carried, { at: 999, ids: ['n1', 'n2'] })
  expect(seeded).toEqual([
    { id: 'n1', text: 'three', source: 'carried', state: 'open', claimId: null, at: 999 },
    { id: 'n2', text: 'five', source: 'carried', state: 'open', claimId: null, at: 999 },
  ])
  expect(seedCarried(carried, { at: 1, ids: ['only'] }).length).toEqual(1)
})

test('carryOver is one hop: a carried ask still untouched at the end is not carried again', () => {
  const asks = [ask('k', 'carried in', 'open', { source: 'carried' }), ask('a', 'asked here')]
  expect(carryOver(asks).map((a) => a.id)).toEqual(['a'])
})

test('seedCarried skips what an older store kept: pale claims, ticked goals and carried asks', () => {
  // The estate store at 2026-10-08: 1 open ask and 9 goals S165 ticked in its own log.
  const stored = [
    ask('a', 'make the usage report show dollar cost'),
    ask('g1', 'fold the estate status into the witness', 'claimed', { source: 'goal' }),
    ask('g2', 'amber eyes', 'claimed', { source: 'goal', claimId: 'c9' }),
    ask('k', 'from two sessions ago', 'open', { source: 'carried' }),
  ]
  const seeded = seedCarried(stored, { at: 5, ids: ['n1', 'n2', 'n3', 'n4'] })
  expect(seeded.map((a) => [a.id, a.text])).toEqual([['n1', 'make the usage report show dollar cost']])
})

test('counts and nm leave carried asks out; carried counts the undone ones on its own', () => {
  const asks = [
    ask('a', 'asked here'),
    ask('k1', 'carried open', 'open', { source: 'carried' }),
    ask('k2', 'carried pale', 'claimed', { source: 'carried' }),
    ask('k3', 'carried done', 'witnessed', { source: 'carried' }),
    ask('k4', 'carried dropped', 'dropped', { source: 'carried' }),
  ]
  expect(counts(asks)).toEqual({ done: 0, total: 1, pale: 0, carried: 2, builds: 0 })
  expect(nm(asks)).toEqual('0/1')
  expect(counts([ask('k', 'only carried', 'open', { source: 'carried' })])).toEqual({ done: 0, total: 0, pale: 0, carried: 1, builds: 0 })
})

test('parseGoals reads [-] as dropped, not ticked', () => {
  const goals = parseGoals('## Goals\n- [-] zero-ink pass dropped\n- [x] done\n- [ ] open\n')
  expect(goals).toEqual([
    { text: 'zero-ink pass dropped', ticked: false, dropped: true },
    { text: 'done', ticked: true, dropped: false },
    { text: 'open', ticked: false, dropped: false },
  ])
})

test('mergeGoals: a goal rescoped in place supersedes the old ask instead of minting a second', () => {
  const before = mergeGoals([], [{ text: 'Drained directives: Linked Page + #n', ticked: false }], { at: 1, ids: ['g1'] })
  const after = mergeGoals(before, [{ text: 'Drained directives: stable key (anchor + content hash)', ticked: false }], {
    at: 2,
    ids: ['g2'],
  })
  expect(after.map((a) => [a.id, a.state])).toEqual([
    ['g1', 'dropped'],
    ['g2', 'open'],
  ])
  expect(counts(after)).toEqual({ done: 0, total: 1, pale: 0, carried: 0, builds: 0 })
})

test('mergeGoals: a goal extended in place keeps its ask, state and claim, with the new text', () => {
  const g = ask('g1', 'Fix the walker', 'claimed', { source: 'goal', claimId: 'c1' })
  const out = mergeGoals([g], [{ text: 'Fix the walker - done, commit abc123', ticked: true }], { at: 2, ids: ['g2'] })
  expect(out).toEqual([{ ...g, text: 'Fix the walker - done, commit abc123' }])
})

test('mergeGoals: a [-] goal drops its ask and adds nothing', () => {
  const g = ask('g1', 'zero-ink pass', 'claimed', { source: 'goal' })
  const out = mergeGoals([g], [{ text: 'zero-ink pass', ticked: false, dropped: true }], { at: 2, ids: ['g2'] })
  expect(out.map((a) => [a.id, a.state])).toEqual([['g1', 'dropped']])
  expect(mergeGoals([], [{ text: 'never seen', ticked: false, dropped: true }], { at: 2, ids: ['g3'] })).toEqual([])
})

test('mergeGoals: a goal removed from the log is dropped unless witnessed; asks Bradley typed are left alone', () => {
  const asks = [
    ask('g1', 'removed open goal', 'open', { source: 'goal' }),
    ask('g2', 'removed witnessed goal', 'witnessed', { source: 'goal', claimId: 'c1' }),
    ask('a', 'typed ask, not in the log'),
    ask('g3', 'still here', 'open', { source: 'goal' }),
  ]
  const out = mergeGoals(asks, [{ text: 'still here', ticked: false }], { at: 2, ids: ['n'] })
  expect(out.map((a) => [a.id, a.state])).toEqual([
    ['g1', 'dropped'],
    ['g2', 'witnessed'],
    ['a', 'open'],
    ['g3', 'open'],
  ])
})

test('mergeGoals with no goals changes nothing: a vanished Goals section never drops the ledger', () => {
  const asks = [ask('g1', 'a goal', 'open', { source: 'goal' })]
  expect(mergeGoals(asks, [], { at: 2, ids: [] })).toEqual(asks)
})

test('mergeGoals: a carried ask this log names as a goal becomes this session\'s goal', () => {
  const k = ask('k', 'make the usage report show dollar cost', 'open', { source: 'carried' })
  const out = mergeGoals([k], [{ text: 'Make the usage report show dollar cost', ticked: false }], { at: 2, ids: ['g'] })
  expect(out).toEqual([{ ...k, source: 'goal' }])
  expect(counts(out)).toEqual({ done: 0, total: 1, pale: 0, carried: 0, builds: 0 })
})

test('paneRows puts carried asks after this session\'s, open before pale', () => {
  const asks = [
    ask('k1', 'carried pale', 'claimed', { source: 'carried' }),
    ask('w', 'done here', 'witnessed'),
    ask('k2', 'carried open', 'open', { source: 'carried' }),
    ask('o', 'open here'),
  ]
  expect(paneRows(asks).map((r) => r.id)).toEqual(['o', 'w', 'k2', 'k1'])
})

test('printSection lists carried asks on their own, the undone said not to carry again', () => {
  const asks = [
    ask('a', 'fix band', 'witnessed'),
    ask('k', 'old ask', 'open', { source: 'carried' }),
    ask('k2', 'old done', 'witnessed', { source: 'carried' }),
    ask('k3', 'old dropped', 'dropped', { source: 'carried' }),
  ]
  expect(printSection(asks, ledger([]))).toEqual(
    [
      '## Witness print',
      '',
      'Asks: 1 of 1 witnessed, 0 pale, 0 open.',
      '',
      '- [x] fix band',
      '',
      'Carried in from the last watch: 1 undone, not carried again.',
      '',
      '- [x] old done (carried)',
      '- [ ] old ask (carried)',
      '',
      PRINT_END,
    ].join('\n'),
  )
})

test('printSection writes the exact markdown', () => {
  const asks = [
    ask('a', 'fix band', 'witnessed'),
    ask('b', 'add pane', 'claimed'),
    ask('c', 'write docs'),
    ask('d', 'gone', 'dropped'),
  ]
  const l = ledger([['c1', 10, 'pale']])
  expect(printSection(asks, l)).toEqual(
    [
      '## Witness print',
      '',
      'Asks: 1 of 3 witnessed, 1 pale, 1 open.',
      '',
      '- [x] fix band',
      '- [ ] add pane (pale: claimed, never witnessed)',
      '- [ ] write docs',
      '',
      '- pale claim: claim c1',
      '',
      PRINT_END,
    ].join('\n'),
  )
  expect(printSection([], ledger([]))).toEqual('## Witness print\n\nAsks: 0 of 0 witnessed, 0 pale, 0 open.\n\n' + PRINT_END)
})

test('whitespace runs collapse in every ask text and print line', () => {
  const inj = 'Done.\n\n## Goals\n- [ ] injected'
  const flat = 'Done. ## Goals - [ ] injected'
  expect(parseExtract(JSON.stringify({ asks: [inj] }))).toEqual([flat])
  expect(mergeGoals([], [{ text: inj, ticked: false }], { at: 1, ids: ['n'] })[0]!.text).toEqual(flat)
  expect(seedCarried([ask('a', inj)], { at: 1, ids: ['n'] })[0]!.text).toEqual(flat)
  const l = ledger([['c1', 1, 'pale']])
  const l2: Ledger = { ...l, claims: l.claims.map((c) => ({ ...c, text: inj })) }
  const out = printSection([ask('a', inj, 'witnessed'), ask('b', inj, 'claimed'), ask('c', inj)], l2)
  expect(parseGoals(out + '\n')).toEqual([])
  expect(out.split('\n').filter((x) => /^## /.test(x))).toEqual(['## Witness print'])
  expect(out.split('\n').filter((x) => x.includes('injected')).every((x) => x.startsWith('- '))).toEqual(true)
})

test('printSection places extra sections before the closing marker, one line each', () => {
  const out = printSection([], ledger([]), ['### Notes taken', '', '- a\n## not a heading'])
  const lines = out.split('\n')
  expect(lines[lines.length - 1]).toEqual(PRINT_END)
  expect(out).toContain('### Notes taken')
  expect(lines.some((l) => l.startsWith('## not a heading'))).toBe(false)
})

test('printSection ends with the closing marker line', () => {
  expect(PRINT_END).toEqual('<!-- /witness print -->')
  const lines = printSection([ask('a', 'x')], ledger([])).split('\n')
  expect(lines[lines.length - 1]).toEqual('<!-- /witness print -->')
})

test('carryOver keeps at most the 30 newest undone asks', () => {
  const many = Array.from({ length: 35 }, (_, i) => ask('a' + i, 'ask ' + i, 'open', { at: i }))
  const out = carryOver(many)
  expect(out.length).toEqual(30)
  expect(out[0]!.id).toEqual('a5')
  expect(out[29]!.id).toEqual('a34')
})

test('prompts list at most the 40 newest asks, keeping original numbering for matchPrompt', () => {
  const many = Array.from({ length: 50 }, (_, i) => ask('a' + i, 'ask number ' + i, 'open', { at: i }))
  const e = extractPrompt('msg', many)
  expect(e.includes('ask number 9\n')).toEqual(false)
  expect(e.includes('ask number 10\n')).toEqual(true)
  expect(e.includes('ask number 49\n')).toEqual(true)
  const m = matchPrompt(many, 'ans')
  expect(m.split('\n').filter((x) => /^\d+\. /.test(x)).length).toEqual(40)
  expect(m.includes('11. ask number 10\n')).toEqual(true)
  expect(m.includes('1. ask number 0\n')).toEqual(false)
})

// Builds (Bradley, 2026-10-08): a 405_85labs /tackle held "Rebuild and reorient 85labs to
// a shippable standard over several days" as a session ask. A multi-session build is held
// apart, and a standing instruction ("explain X as we build") is not recorded at all.

test('extractPrompt asks for this session\'s asks and multi-session builds apart, and leaves out standing instructions', () => {
  const p = extractPrompt('msg', [])
  expect(p).toContain('Output shape: {"asks": ["imperative"], "builds": ["imperative"]}')
  expect(p).toContain('several sessions')
  expect(p).toContain('standing instruction')
})

test('extractPrompt reads an approval against the end of the answer it approves', () => {
  const previous = 'x'.repeat(5000) + ' Proposal: add a Photos tab.'
  const p = extractPrompt('that looks great, greenlight', [], previous)
  expect(p).toContain('greenlight')
  expect(p).toContain('Proposal: add a Photos tab.')
  // Only the end of a long answer, where a proposal sits.
  expect(p.includes('x'.repeat(MAX_PREVIOUS_CHARS))).toEqual(false)
  // The fixed text first, then the previous answer, then the message.
  expect(p.indexOf('Reply with the JSON only.') < p.indexOf('Proposal: add a Photos tab.')).toEqual(true)
  expect(p.indexOf('Proposal: add a Photos tab.') < p.indexOf('that looks great, greenlight')).toEqual(true)
  // With no previous answer the section is absent, not an empty quote.
  expect(p).toContain("The end of the assistant's previous message:")
  expect(extractPrompt('fix the band', []).includes("The end of the assistant's previous message:")).toEqual(false)
})

test('extractPrompt leaves out conditional instructions as well as standing ones', () => {
  expect(extractPrompt('msg', [])).toContain('conditional')
})

// A field report (405_85labs): /tackle's own method lines ("Sweep the witness items first", "Close each
// item with a read-back") became four asks. A field report (pm): "build an /agile ultracode" became
// "Build an /agile ultracode skill", an ask Bradley never made.
test('extractPrompt leaves out method steps and keeps the person\'s own words', () => {
  const p = extractPrompt('msg', [])
  expect(p).toContain('method steps')
  expect(p).toContain('Never add a word')
})

test('extractPrompt leaves out what the person quotes or pastes to talk about', () => {
  expect(extractPrompt('msg', [])).toContain('quotes or pastes')
})

test('extractPrompt leaves out a question whether something could be done', () => {
  expect(extractPrompt('msg', [])).toContain('"can we also have X?"')
})

test('parseExtraction splits asks from builds, dedupes across both and the existing list, caps builds at 3', () => {
  const reply = JSON.stringify({
    asks: ['Complete the Stripe Connect build', 'add a pane'],
    builds: ['Rebuild 85labs to a shippable standard', 'Complete the Stripe Connect build', 'Build 18 apps', 'Plan a database', 'one too many'],
  })
  const existing = [ask('1', 'add a pane')]
  expect(parseExtraction(reply, existing)).toEqual({
    asks: ['Complete the Stripe Connect build'],
    builds: ['Rebuild 85labs to a shippable standard', 'Build 18 apps', 'Plan a database'],
  })
  expect(parseExtract(reply, existing)).toEqual(['Complete the Stripe Connect build'])
  expect(parseExtraction('{"asks": ["x"]}')).toEqual({ asks: ['x'], builds: [] })
  expect(parseExtraction('junk')).toEqual({ asks: [], builds: [] })
})

test('builds are never in asks n/m; counts gives the live ones on their own', () => {
  const asks = [
    ask('a', 'asked here'),
    ask('b1', 'Rebuild 85labs', 'open', { source: 'build' }),
    ask('b2', 'gone', 'dropped', { source: 'build' }),
  ]
  expect(counts(asks)).toEqual({ done: 0, total: 1, pale: 0, carried: 0, builds: 1 })
  expect(nm(asks)).toEqual('0/1')
})

test('a build is never carried: /close makes it a to-do instead', () => {
  const b = ask('b', 'Rebuild 85labs', 'open', { source: 'build' })
  expect(carryOver([b, ask('a', 'asked here')]).map((a) => a.id)).toEqual(['a'])
  expect(seedCarried([b], { at: 1, ids: ['n'] })).toEqual([])
})

test('paneRows puts builds last, after the carried', () => {
  const asks = [
    ask('b', 'build one', 'open', { source: 'build' }),
    ask('k', 'carried', 'open', { source: 'carried' }),
    ask('o', 'open here'),
  ]
  expect(paneRows(asks).map((r) => r.id)).toEqual(['o', 'k', 'b'])
})

test('printSection lists builds on their own, each for the to-do list', () => {
  const asks = [ask('a', 'fix band', 'witnessed'), ask('b', 'Rebuild 85labs', 'open', { source: 'build' })]
  expect(printSection(asks, ledger([]))).toEqual(
    [
      '## Witness print',
      '',
      'Asks: 1 of 1 witnessed, 0 pale, 0 open.',
      '',
      '- [x] fix band',
      '',
      'Builds (multi-session; each becomes a to-do at /close): 1.',
      '',
      '- Rebuild 85labs (build)',
      '',
      PRINT_END,
    ].join('\n'),
  )
})

test('mergeGoals: a build this log names as a goal becomes this session\'s goal', () => {
  const b = ask('b', 'Plan a separate database for 85labs', 'open', { source: 'build' })
  const out = mergeGoals([b], [{ text: 'Plan a separate database for 85labs', ticked: false }], { at: 2, ids: ['g'] })
  expect(out).toEqual([{ ...b, source: 'goal' }])
})

// A field report (pm): /start wrote Goals restating Bradley's prompt, and the band read
// "0 of 7" for 4 requests. Two of the three pairs, quoted from the report:
test('mergeGoals matches a Goal to the typed ask it restates, keeping the ask\'s id and claim', () => {
  const asks = [
    ask('a1', 'Update the skill itself with a far greater horizon', 'claimed', { claimId: 'c1' }),
    ask('a2', 'Build an /agile ultracode skill that allows us to clear the board'),
  ]
  const goals = [
    { text: 'Update the /direction-update skill itself to a far greater horizon', ticked: false },
    { text: "Build and run an /agile ultracode workflow that clears PM's board", ticked: false },
  ]
  const out = mergeGoals(asks, goals, { at: 2, ids: ['g1', 'g2'] })
  expect(out.map((a) => [a.id, a.source, a.state, a.claimId, a.text])).toEqual([
    ['a1', 'goal', 'claimed', 'c1', 'Update the /direction-update skill itself to a far greater horizon'],
    ['a2', 'goal', 'open', null, "Build and run an /agile ultracode workflow that clears PM's board"],
  ])
  expect(counts(out).total).toEqual(2)
})

test('mergeGoals keeps two short asks that share only a couple of words apart', () => {
  const out = mergeGoals([ask('a', 'Fix the band colour')], [{ text: 'Fix the band width', ticked: false }], { at: 2, ids: ['g'] })
  expect(out.map((a) => [a.id, a.source])).toEqual([
    ['a', 'ask'],
    ['g', 'goal'],
  ])
})

// A field report (405_85labs): /close Step 4b dismissed eight carried asks with evidence,
// and a /tackle after the close offered the same eight again.
const TRIAGED = [
  '# Session',
  '',
  '## Witness print',
  '- [ ] Plan a separate full database for 85 labs (carried)',
  '<!-- /witness print -->',
  '',
  '## Witness triage',
  '',
  '- dismissed: Plan a separate full database for 85 labs (carried) - already on the board as Phase 0',
  '- to-do: Complete the Stripe Connect build in this session -> https://www.notion.example/abc',
  '- something else entirely',
  '',
  '## Session Closed',
].join('\n')

test('parseTriage reads the dismissed and to-do lines under ## Witness triage only', () => {
  expect(parseTriage(TRIAGED)).toEqual({
    dismissed: ['Plan a separate full database for 85 labs (carried) - already on the board as Phase 0'],
    todo: ['Complete the Stripe Connect build in this session -> https://www.notion.example/abc'],
  })
  expect(parseTriage('## Goals\n- dismissed: not a triage line\n')).toEqual({ dismissed: [], todo: [] })
})

test('applyTriage settles what the close triaged: dismissed drops, to-do leaves the undone; nothing else moves', () => {
  const asks = [
    ask('k1', 'Plan a separate full database for 85 labs', 'claimed', { source: 'carried' }),
    ask('k2', 'Complete the Stripe Connect build in this session', 'open', { source: 'carried' }),
    ask('k3', 'Do the recording pass', 'open', { source: 'carried' }),
    ask('w', 'Plan a separate full database for 85 labs ok', 'witnessed'),
  ]
  const out = applyTriage(asks, parseTriage(TRIAGED))
  expect(out.map((a) => [a.id, a.state, a.settled ?? null])).toEqual([
    ['k1', 'dropped', 'dismissed'],
    ['k2', 'open', 'to-do'],
    ['k3', 'open', null],
    ['w', 'witnessed', null],
  ])
  expect(carryOver([ask('t', 'routed', 'open', { settled: 'to-do' }), ask('o', 'still open')]).map((a) => a.id)).toEqual(['o'])
})
