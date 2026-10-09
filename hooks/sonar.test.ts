import { test, expect } from 'claude-code/testing'
import type { Beat, Hand, Overlap } from '../types'
import {
  BEAT_MS,
  GOAL_CHARS,
  HAND_TAG,
  HAND_TEXT_MAX,
  LIVE_MS,
  MAX_BEAT_WRITES,
  MAX_GOALS,
  OVERLAP_MS,
  SHARED_CLAUDE_DIRS,
  beatDays,
  beatFile,
  beatPath,
  dayOf,
  findPod,
  freshOverlaps,
  handAction,
  handEnvelope,
  handFile,
  handPath,
  handPrompt,
  handsDir,
  isForgedHand,
  isWitnessHand,
  livePods,
  makeBeat,
  newcomers,
  overlaps,
  parseBeat,
  parseHand,
  parseHandArgs,
  parseHandFile,
  podLabel,
  recentWrites,
  safeId,
  sharedPlace,
  sonarDir,
  touchesSonar,
} from './sonar'
// The display helpers moved to podview.ts when an overlap gained a kind (1.2, the wider pings).
import { bandPods, fmtAge, newcomerText, overlapText, podRows } from './podview'

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)
const MIN = 60_000

const beat = (o: Partial<Beat> = {}): Beat => ({
  format: 'witness-sonar',
  version: 1,
  sessionId: 'aaaa-1111',
  repo: 'c:/p/alpha',
  root: 'c:/p/alpha',
  name: 'alpha',
  startedAt: T0 - 60 * MIN,
  beatAt: T0,
  state: 'working',
  goals: [],
  asks: '0/0',
  writes: [],
  ...o,
})

const hand = (o: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  from: 'abcd-1234',
  fromName: 'alpha',
  typed: true,
  text: 'Fix the build.\nThen run the tests.',
  at: 5,
  ...o,
})

const HOME = 'C:\\Home\\ada'

// ---- constants and paths ----

test('the contract constants', () => {
  expect([BEAT_MS, LIVE_MS, OVERLAP_MS]).toEqual([30_000, 120_000, 1_800_000])
  expect([MAX_BEAT_WRITES, MAX_GOALS, GOAL_CHARS, HAND_TEXT_MAX]).toEqual([20, 3, 90, 2000])
  expect([...SHARED_CLAUDE_DIRS]).toEqual(['rules', 'skills', 'tools', 'agents'])
  expect(HAND_TAG).toBe('[witness hand')
})

test('sonarDir: a Windows home becomes forward slashes; no home, no folder', () => {
  expect(sonarDir('C:\\Home\\ada')).toBe('C:/Home/ada/.claude/state/witness-sonar')
  expect(sonarDir('C:\\Home\\ada\\')).toBe('C:/Home/ada/.claude/state/witness-sonar')
  expect(sonarDir('/home/b/')).toBe('/home/b/.claude/state/witness-sonar')
  expect(sonarDir(undefined)).toBeNull()
  expect(sonarDir('')).toBeNull()
  expect(sonarDir('   ')).toBeNull()
})

test('safeId keeps letters, digits, dot, underscore and hyphen, and nothing else', () => {
  expect(safeId('abcd-1234_x.y')).toBe('abcd-1234_x.y')
  expect(safeId('a/b c:d\\e')).toBe('a_b_c_d_e')
  expect(safeId('../x')).toBe('.._x')
})

test('beatPath is the day of the beat; beatDays are today and yesterday, across midnight UTC', () => {
  const late = Date.UTC(2026, 9, 9, 23, 59, 59, 999)
  const early = Date.UTC(2026, 9, 10, 0, 0, 0, 0)
  expect(dayOf(late)).toBe('2026-10-09')
  expect(dayOf(early)).toBe('2026-10-10')
  expect(beatPath('/d', late, 'a/b')).toBe('/d/2026-10-09/a_b.json')
  expect(beatPath('/d', early, 'abcd')).toBe('/d/2026-10-10/abcd.json')
  expect(beatDays(Date.UTC(2026, 9, 10, 0, 0, 1))).toEqual(['2026-10-10', '2026-10-09'])
  expect(beatDays(Date.UTC(2026, 10, 1, 5))).toEqual(['2026-11-01', '2026-10-31'])
})

test('handsDir and handPath put a hand under the receiver, ids made path-safe', () => {
  expect(handsDir('/d', 'ab/cd')).toBe('/d/hands/ab_cd')
  expect(handPath('/d', 'abcd', 'h 1')).toBe('/d/hands/abcd/h_1.json')
})

// ---- beats ----

test('makeBeat normalises repo and root, keeps the name as written, and bounds goals and writes', () => {
  const long = `${'g'.repeat(200)}`
  const b = makeBeat({
    sessionId: 's1',
    cwd: 'C:\\Home\\Ada\\Python\\101_Proj\\',
    root: 'C:\\Home\\Ada\\Python',
    startedAt: 1,
    now: 2,
    state: 'idle',
    goals: ['first\nline two', long, '  ', 'third', 'fourth'],
    asks: '3/7 ~1',
    writes: Array.from({ length: 25 }, (_, i) => ({ path: `c:/f/${i}`, at: i })),
  })
  expect(b.format).toBe('witness-sonar')
  expect(b.version).toBe(1)
  expect(b.repo).toBe('c:/home/ada/python/101_proj')
  expect(b.root).toBe('c:/home/ada/python')
  expect(b.name).toBe('101_Proj')
  expect(b.beatAt).toBe(2)
  expect(b.startedAt).toBe(1)
  expect(b.state).toBe('idle')
  expect(b.asks).toBe('3/7 ~1')
  expect(b.goals.length).toBe(MAX_GOALS)
  expect(b.goals[0]).toBe('first line two')
  expect(b.goals[1]!.length).toBe(GOAL_CHARS)
  expect(b.goals[1]!.endsWith('...')).toBe(true)
  expect(b.goals[2]).toBe('third')
  expect(b.writes.length).toBe(MAX_BEAT_WRITES)
})

test('makeBeat: no git root is null', () => {
  const b = makeBeat({ sessionId: 's', cwd: '/tmp/x', root: null, startedAt: 0, now: 1, state: 'working', goals: [], asks: '', writes: [] })
  expect(b.root).toBeNull()
  expect(b.name).toBe('x')
})

test('makeBeat -> beatFile -> parseBeat is a round trip', () => {
  const b = makeBeat({
    sessionId: 'abcd-1',
    cwd: 'C:\\w\\Proj',
    root: 'C:\\w\\Proj',
    startedAt: 10,
    now: 20,
    state: 'working',
    goals: ['ship it'],
    asks: '1/2',
    writes: [{ path: 'c:/w/proj/a.ts', at: 15 }],
  })
  expect(parseBeat(beatFile(b))).toEqual(b)
})

test('parseBeat refuses what it cannot trust and ignores what it does not know', () => {
  const good = beat({ goals: ['g'], writes: [{ path: 'c:/p/alpha/a', at: 1 }] })
  const text = (o: Record<string, unknown>): string => JSON.stringify({ ...good, ...o })
  expect(parseBeat(beatFile(good))).toEqual(good)
  expect(parseBeat(text({ version: 2 }))).toBeNull()
  expect(parseBeat(text({ version: '1' }))).toBeNull()
  expect(parseBeat(text({ format: 'other' }))).toBeNull()
  expect(parseBeat(text({ state: 'asleep' }))).toBeNull()
  expect(parseBeat(text({ sessionId: '' }))).toBeNull()
  expect(parseBeat(text({ sessionId: 7 }))).toBeNull()
  expect(parseBeat(text({ beatAt: null }))).toBeNull()
  expect(parseBeat(text({ startedAt: 'soon' }))).toBeNull()
  expect(parseBeat('{"format":"witness-sonar","version":1,"sessionId":"a","state":"idle","startedAt":1,"beatAt":1e999}')).toBeNull()
  expect(parseBeat('not json {')).toBeNull()
  expect(parseBeat('[]')).toBeNull()
  expect(parseBeat('null')).toBeNull()
  const extra = parseBeat(text({ secret: 'x', nested: { a: 1 } }))
  expect(extra).toEqual(good)
  expect('secret' in extra!).toBe(false)
})

test('parseBeat filters malformed goals and writes, and bounds a hostile file', () => {
  const b = parseBeat(
    JSON.stringify({
      ...beat(),
      root: 7,
      goals: ['ok', 3, null, { a: 1 }, 'two', 'three', 'four'],
      writes: [{ path: 'c:/a', at: 1 }, { path: 'c:/b' }, { path: 5, at: 2 }, null, 'x', { path: 'c:/c', at: 1e999 }],
    }),
  )
  expect(b!.root).toBeNull()
  expect(b!.goals).toEqual(['ok', 'two', 'three'])
  expect(b!.writes).toEqual([{ path: 'c:/a', at: 1 }])
  const many = parseBeat(JSON.stringify({ ...beat(), writes: Array.from({ length: 50 }, (_, i) => ({ path: `c:/${i}`, at: i })) }))
  expect(many!.writes.length).toBe(MAX_BEAT_WRITES)
})

test('recentWrites: files only, no wildcard, inside the window, distinct, newest first, capped', () => {
  const w = (kind: string, target: string, at: number) => ({ kind, target, at })
  const out = recentWrites(
    [
      w('file', 'c:/a', T0 - 5 * MIN),
      w('sql', 'public.t', T0 - MIN),
      w('file', 'c:/src/*.ts', T0 - MIN),
      w('file', 'c:/old', T0 - OVERLAP_MS - 1),
      w('file', 'c:/b', T0 - 10 * MIN),
      w('file', 'c:/a', T0 - 2 * MIN),
      w('file', 'c:/edge', T0 - OVERLAP_MS),
    ],
    T0,
  )
  expect(out).toEqual([
    { path: 'c:/a', at: T0 - 2 * MIN },
    { path: 'c:/b', at: T0 - 10 * MIN },
    { path: 'c:/edge', at: T0 - OVERLAP_MS },
  ])
  const flood = Array.from({ length: 40 }, (_, i) => w('file', `c:/f${i}`, T0 - i))
  const capped = recentWrites(flood, T0)
  expect(capped.length).toBe(MAX_BEAT_WRITES)
  expect(capped[0]!.path).toBe('c:/f0')
})

test('livePods: fresh, not ended, not self, one per session, sorted by name then start', () => {
  const pods = [
    beat({ sessionId: 'z1', name: 'Zed', beatAt: T0 }),
    beat({ sessionId: 'stale', name: 'old', beatAt: T0 - LIVE_MS - 1 }),
    beat({ sessionId: 'edge', name: 'edge', beatAt: T0 - LIVE_MS }),
    beat({ sessionId: 'gone', name: 'gone', beatAt: T0, state: 'ended' }),
    beat({ sessionId: 'me', name: 'me', beatAt: T0 }),
    beat({ sessionId: 'a1', name: 'alpha', beatAt: T0 - 50_000, goals: ['older'] }),
    beat({ sessionId: 'a1', name: 'alpha', beatAt: T0 - 10_000, goals: ['newer'] }),
    beat({ sessionId: 'a2', name: 'Alpha', startedAt: 5, beatAt: T0 }),
    beat({ sessionId: 'a3', name: 'ALPHA', startedAt: 1, beatAt: T0 }),
  ]
  const live = livePods(pods, { now: T0, self: 'me' })
  // Name case-insensitively, then startedAt: the three alphas by start (1, 5, T0 - 60 min), edge, Zed.
  expect(live.map((b) => b.sessionId)).toEqual(['a3', 'a2', 'a1', 'edge', 'z1'])
  expect(live.find((b) => b.sessionId === 'a1')!.goals).toEqual(['newer'])
})

test('livePods: a session whose newest beat is ended is gone, even if an older beat says working', () => {
  const pods = [
    beat({ sessionId: 'x1', beatAt: T0 - 20_000, state: 'working' }),
    beat({ sessionId: 'x1', beatAt: T0 - 5_000, state: 'ended' }),
    beat({ sessionId: 'x2', beatAt: T0 - 5_000, state: 'idle' }),
    beat({ sessionId: 'x2', beatAt: T0 - 20_000, state: 'working' }),
  ]
  const live = livePods(pods, { now: T0, self: 'me' })
  expect(live.map((b) => `${b.sessionId}:${b.state}`)).toEqual(['x2:idle'])
})

// ---- overlaps ----

test('sharedPlace: the same repo and the shared ~/.claude folders, nothing else', () => {
  const roots = ['c:/p/alpha', null]
  const home = 'c:/home/ada'
  expect(sharedPlace('c:/p/alpha/src/a.ts', roots, home)).toBe(true)
  expect(sharedPlace('c:/home/ada/.claude/skills/x/skill.md', roots, home)).toBe(true)
  for (const d of SHARED_CLAUDE_DIRS) expect(sharedPlace(`c:/home/ada/.claude/${d}/f.md`, [], home)).toBe(true)
  expect(sharedPlace('c:/home/ada/.claude/claude.md', [], home)).toBe(true)
  expect(sharedPlace('c:/home/ada/.claude/projects/p/memory/m.md', roots, home)).toBe(false)
  expect(sharedPlace('c:/home/ada/.claude/settings.json', roots, home)).toBe(false)
  expect(sharedPlace('c:/home/ada/appdata/local/temp/claude/x/scratchpad/a.txt', roots, home)).toBe(false)
  expect(sharedPlace('c:/p/beta/a.ts', roots, home)).toBe(false)
  expect(sharedPlace('c:/p/alpha2/a.ts', roots, home)).toBe(false)
  expect(sharedPlace('c:/p/alpha', roots, home)).toBe(false)
})

test('sharedPlace: backslash, case and trailing-slash variants; no home, no ~/.claude; no empty root', () => {
  expect(sharedPlace('C:\\P\\Alpha\\src\\A.ts', ['C:\\p\\alpha\\'], null)).toBe(true)
  expect(sharedPlace('C:\\Home\\ADA\\.claude\\Skills\\X\\SKILL.md', [], HOME)).toBe(true)
  expect(sharedPlace('C:\\Home\\ada\\.claude\\CLAUDE.md', [], 'C:\\Home\\ada\\')).toBe(true)
  expect(sharedPlace('c:/home/ada/.claude/skills/x', [], null)).toBe(false)
  expect(sharedPlace('/etc/passwd', ['', null], null)).toBe(false)
  expect(sharedPlace('/etc/passwd', [null, null], '')).toBe(false)
})

const home = 'c:/home/ada'
const w = (path: string, at: number) => ({ path, at })

test('overlaps: the same file in the same repo is one overlap, newest time, the peer named', () => {
  const pod = beat({ sessionId: 'peer1', name: 'beta', root: 'c:/p/alpha', writes: [w('c:/p/alpha/a.ts', T0 - 5 * MIN)] })
  const out = overlaps({ mine: [w('c:/p/alpha/a.ts', T0 - 2 * MIN), w('c:/p/alpha/b.ts', T0)], myRoot: 'c:/p/alpha', pods: [pod], home, now: T0 })
  expect(out).toEqual([{ path: 'c:/p/alpha/a.ts', peer: 'peer1', peerName: 'beta', at: T0 - 2 * MIN }])
})

test('overlaps: a shared ~/.claude/rules file across two different repos overlaps', () => {
  const rule = 'c:/home/ada/.claude/rules/common/git.md'
  const pod = beat({ sessionId: 'p2', name: 'beta', root: 'c:/p/beta', writes: [w(rule, T0 - MIN)] })
  const out = overlaps({ mine: [w(rule, T0 - 3 * MIN)], myRoot: 'c:/p/alpha', pods: [pod], home, now: T0 })
  expect(out.map((o) => [o.path, o.peer, o.at])).toEqual([[rule, 'p2', T0 - MIN]])
})

test('overlaps: a scratchpad file both wrote, a file in different repos, or an old write is none', () => {
  const scratch = 'c:/home/ada/appdata/local/temp/claude/s/scratchpad/n.txt'
  const pod = beat({ sessionId: 'p3', root: 'c:/p/beta', writes: [w(scratch, T0), w('c:/p/alpha/x.ts', T0), w('c:/p/alpha/old.ts', T0 - OVERLAP_MS - 1)] })
  const mine = [w(scratch, T0), w('c:/p/alpha/old.ts', T0 - OVERLAP_MS - 1)]
  expect(overlaps({ mine, myRoot: 'c:/p/alpha', pods: [pod], home, now: T0 })).toEqual([])
  const old = beat({ sessionId: 'p4', root: 'c:/p/alpha', writes: [w('c:/p/alpha/old.ts', T0 - OVERLAP_MS - 1)] })
  expect(overlaps({ mine: [w('c:/p/alpha/old.ts', T0)], myRoot: 'c:/p/alpha', pods: [old], home, now: T0 })).toEqual([])
})

test('overlaps: distinct by path and peer, newest first, path case and slashes ignored in the match', () => {
  const p1 = beat({ sessionId: 'p1', name: 'one', writes: [w('c:/p/alpha/a.ts', T0 - 4 * MIN), w('c:/p/alpha/b.ts', T0 - MIN)] })
  const p2 = beat({ sessionId: 'p2', name: 'two', writes: [w('C:\\P\\Alpha\\A.ts', T0 - MIN)] })
  const mine = [w('c:/p/alpha/a.ts', T0 - 9 * MIN), w('c:/p/alpha/a.ts', T0 - 3 * MIN), w('c:/p/alpha/b.ts', T0 - 2 * MIN)]
  const out = overlaps({ mine, myRoot: 'c:/p/alpha', pods: [p1, p2], home, now: T0 })
  expect(out.map((o) => [o.path, o.peer, o.at])).toEqual([
    ['c:/p/alpha/b.ts', 'p1', T0 - MIN],
    ['c:/p/alpha/a.ts', 'p2', T0 - MIN],
    ['c:/p/alpha/a.ts', 'p1', T0 - 3 * MIN],
  ])
})

test('freshOverlaps: only those whose path and peer were not already known', () => {
  const o = (path: string, peer: string, at = 1): Overlap => ({ path, peer, peerName: peer, at })
  const prev = [o('a', 'p1'), o('b', 'p1')]
  const next = [o('a', 'p1', 9), o('a', 'p2'), o('c', 'p1')]
  expect(freshOverlaps(prev, next).map((x) => `${x.path}:${x.peer}`)).toEqual(['a:p2', 'c:p1'])
  expect(freshOverlaps([], next).length).toBe(3)
  expect(freshOverlaps(prev, [])).toEqual([])
})

test('newcomers: pods in this repo (case ignored) that are not already known', () => {
  const pods = [
    beat({ sessionId: 'n1', repo: 'c:/p/alpha' }),
    beat({ sessionId: 'n2', repo: 'C:/P/Alpha' }),
    beat({ sessionId: 'n3', repo: 'c:/p/beta' }),
    beat({ sessionId: 'k1', repo: 'c:/p/alpha' }),
  ]
  expect(newcomers(['k1'], pods, 'c:/p/alpha').map((b) => b.sessionId)).toEqual(['n1', 'n2'])
  expect(newcomers([], pods, 'C:/P/ALPHA').length).toBe(3)
})

// ---- addressing ----

test('podLabel is the name and the first four of the session id', () => {
  expect(podLabel(beat({ name: '101_Proj', sessionId: 'abcdef-12' }))).toBe('101_Proj abcd')
})

test('findPod: by index, by id prefix, by name prefix; ambiguous and none', () => {
  const pods = [
    beat({ sessionId: 'abcd-1111', name: 'Overseer' }),
    beat({ sessionId: 'abce-2222', name: 'Overseer-two' }),
    beat({ sessionId: 'f00d-3333', name: 'blog' }),
  ]
  expect(findPod(pods, '1')).toBe(pods[0])
  expect(findPod(pods, ' 3 ')).toBe(pods[2])
  expect(findPod(pods, '4')).toBeNull()
  expect(findPod(pods, '0')).toBeNull()
  expect(findPod(pods, 'abcd')).toBe(pods[0])
  expect(findPod(pods, 'f00d-33')).toBe(pods[2])
  expect(findPod(pods, 'abc')).toBeNull()
  expect(findPod(pods, 'bl')).toBe(pods[2])
  expect(findPod(pods, 'over')).toBe('ambiguous')
  expect(findPod(pods, 'overseer-t')).toBe(pods[1])
  expect(findPod(pods, 'zzzz')).toBeNull()
  expect(findPod(pods, '')).toBeNull()
  expect(findPod([], '1')).toBeNull()
})

test('findPod: an id prefix under four characters falls to the name; four that match two ids is ambiguous', () => {
  const pods = [beat({ sessionId: 'abcd-1111', name: 'abc-app' }), beat({ sessionId: 'abcd-2222', name: 'other' })]
  expect(findPod(pods, 'abc')).toBe(pods[0])
  expect(findPod(pods, 'abcd')).toBe('ambiguous')
  expect(findPod(pods, 'abcd-1')).toBe(pods[0])
})

test('parseHandArgs: first token is the pod, the rest is the text', () => {
  expect(parseHandArgs('abcd fix the build')).toEqual({ ref: 'abcd', text: 'fix the build' })
  expect(parseHandArgs('  2   line one\nline two  ')).toEqual({ ref: '2', text: 'line one\nline two' })
  expect(parseHandArgs('abcd')).toBeNull()
  expect(parseHandArgs('abcd   ')).toBeNull()
  expect(parseHandArgs('')).toBeNull()
  expect(parseHandArgs('   ')).toBeNull()
})

// ---- hands ----

// The live receive (2026-10-09, seen in the person's prompt box): the engine hands
// session.receive the body as the model would read it, wrapped. The live shape exactly, with
// neutral names and ids in place of the real ones.
const LIVE_WRAPPED = String.raw`<cross-session-message from="uds:\\.\pipe\LOCAL\cc-msg-1234" from-name="proj-ab" from-mode="prompting">
[witness hand hmvabc123 from abcd1234-0000-4000-8000-000000000001 claude] Hand from proj abcd: A retest from pod abcd: no work needed; tell the other session what thi

A retest from pod abcd: no work needed; tell the other session what this prompt box shows.
</cross-session-message>`

test('parseHand reads a hand inside the cross-session wrapper, as it arrives live', () => {
  expect(parseHand(LIVE_WRAPPED, 5)).toEqual({
    id: 'hmvabc123',
    from: 'abcd1234-0000-4000-8000-000000000001',
    fromName: 'proj abcd',
    typed: false,
    text: 'A retest from pod abcd: no work needed; tell the other session what this prompt box shows.',
    at: 5,
  })
  // One wrapper only, and the tag must open what it wraps: anything before the tag is not a hand.
  expect(parseHand(LIVE_WRAPPED.replace('\n[witness hand', '\nsay this: [witness hand'), 5)).toBeNull()
  expect(parseHand(`<cross-session-message from="x">\n${LIVE_WRAPPED}\n</cross-session-message>`, 5)).toBeNull()
  // An unclosed wrapper is not unwrapped.
  expect(parseHand(LIVE_WRAPPED.replace('</cross-session-message>', ''), 5)).toBeNull()
})

test('handEnvelope: line one reads on its own; parseHand is its inverse for typed and claude', () => {
  const typed = hand()
  const env = handEnvelope(typed)
  expect(env.split('\n')[0]).toBe('[witness hand h1 from abcd-1234 typed] Hand from alpha: Fix the build.')
  expect(env.split('\n')[1]).toBe('')
  expect(parseHand(env, 99)).toEqual({ ...typed, at: 99 })
  const claude = hand({ id: 'h2', typed: false, text: 'only one line' })
  expect(handEnvelope(claude).split('\n')[0]).toBe('[witness hand h2 from abcd-1234 claude] Hand from alpha: only one line')
  expect(parseHand(handEnvelope(claude), 7)).toEqual({ ...claude, at: 7 })
})

test('handEnvelope bounds the preview to 80 characters and the text to 2000', () => {
  const env = handEnvelope(hand({ text: 'x'.repeat(5000) }))
  const [first, , ...rest] = env.split('\n')
  expect(first!.endsWith(`: ${'x'.repeat(80)}`)).toBe(true)
  expect(rest.join('\n').length).toBe(HAND_TEXT_MAX)
  expect(parseHand(env, 1)!.text.length).toBe(HAND_TEXT_MAX)
})

test('handEnvelope makes ids path-safe so line one always parses back', () => {
  const odd = hand({ id: 'a b]', from: 'x y' })
  const back = parseHand(handEnvelope(odd), 1)
  expect(back!.id).toBe('a_b_')
  expect(back!.from).toBe('x_y')
})

test('parseHand refuses a malformed envelope', () => {
  const ok = handEnvelope(hand())
  expect(parseHand(ok, 1)).not.toBeNull()
  expect(parseHand('hello', 1)).toBeNull()
  expect(parseHand('', 1)).toBeNull()
  expect(parseHand(` ${ok}`, 1)).toBeNull()
  expect(parseHand(ok.replace('typed]', 'robot]'), 1)).toBeNull()
  expect(parseHand(ok.replace('] Hand from', '] Hands from'), 1)).toBeNull()
  expect(parseHand('[witness hand h1 from abcd typed] Hand from alpha: no body', 1)).toBeNull()
  expect(parseHand('[witness hand h1 from abcd typed] Hand from alpha: x\n\n   \n', 1)).toBeNull()
  expect(parseHand('[witness hand h1 typed] Hand from alpha: x\n\nbody', 1)).toBeNull()
})

test('parseHand reads a CRLF envelope and keeps a multi-paragraph body', () => {
  const env = handEnvelope(hand({ text: 'one\n\ntwo' })).replace(/\n/g, '\r\n')
  expect(parseHand(env, 3)!.text).toBe('one\r\n\r\ntwo')
  expect(parseHand(handEnvelope(hand({ text: 'one\n\ntwo' })), 3)!.text).toBe('one\n\ntwo')
})

test('isWitnessHand: only a peer message from the witness plugin', () => {
  expect(isWitnessHand({ kind: 'peer', plugin: 'witness' })).toBe(true)
  expect(isWitnessHand({ kind: 'peer', plugin: 'witness', extra: 1 })).toBe(true)
  expect(isWitnessHand({ kind: 'peer', plugin: 'other' })).toBe(false)
  expect(isWitnessHand({ kind: 'user', plugin: 'witness' })).toBe(false)
  expect(isWitnessHand({ kind: 'peer' })).toBe(false)
  for (const bad of [null, undefined, 'peer', 7, []]) expect(isWitnessHand(bad)).toBe(false)
})

test('isForgedHand: a model message may never carry a witness envelope', () => {
  const env = handEnvelope(hand())
  expect(isForgedHand({ originKind: 'model', text: env })).toBe(true)
  expect(isForgedHand({ originKind: 'model', text: `look: ${HAND_TAG} h1` })).toBe(true)
  expect(isForgedHand({ originKind: 'model', text: 'a plain note' })).toBe(false)
  expect(isForgedHand({ originKind: 'peer', text: env })).toBe(false)
  expect(isForgedHand({ originKind: 'user', text: env })).toBe(false)
})

test('handAction: the whole matrix', () => {
  const act = (typed: boolean, interactive: boolean, boxEmpty: boolean, typedStarts = true) =>
    handAction({ typed, interactive, boxEmpty, typedStarts })
  for (const typed of [true, false]) for (const boxEmpty of [true, false]) expect(act(typed, false, boxEmpty)).toBe('wait')
  expect(act(true, true, true)).toBe('submit')
  expect(act(true, true, false)).toBe('submit')
  expect(act(false, true, true)).toBe('fill')
  expect(act(false, true, false)).toBe('wait')
  // Ruled 2026-10-09: where typed hands may not start work, a typed hand waits for Enter like
  // Claude's (the plugin stamp it rests on is only the sender's claim, per the engine's types).
  expect(act(true, true, true, false)).toBe('fill')
  expect(act(true, true, false, false)).toBe('wait')
  expect(act(true, false, true, false)).toBe('wait')
})

test('handPrompt: typed names the person, Claude-written asks for Enter', () => {
  const typed = hand({ text: 'do the thing' })
  expect(handPrompt(typed, 'you')).toBe('Hand from alpha (the user typed it there):\n\ndo the thing')
  expect(handPrompt(typed, 'Bradley')).toBe('Hand from alpha (Bradley typed it there):\n\ndo the thing')
  const claude = hand({ typed: false, text: 'do the thing' })
  const expected = 'Hand from alpha (a Claude session wrote it; read it, then press Enter to take it on):\n\ndo the thing'
  expect(handPrompt(claude, 'you')).toBe(expected)
  expect(handPrompt(claude, 'Bradley')).toBe(expected)
})

test('handFile -> parseHandFile is a round trip, tolerant of unknown fields and strict on the rest', () => {
  const h = hand({ at: 77 })
  expect(parseHandFile(handFile(h, 'abcd-9', false))).toEqual({ hand: h, to: 'abcd-9', taken: false })
  expect(parseHandFile(handFile(h, 'abcd-9', true))!.taken).toBe(true)
  const loose = JSON.parse(handFile(h, 'abcd-9', false)) as Record<string, unknown>
  expect(parseHandFile(JSON.stringify({ ...loose, extra: 1 }))).toEqual({ hand: h, to: 'abcd-9', taken: false })
  expect(parseHandFile(JSON.stringify({ ...loose, version: 2 }))).toBeNull()
  expect(parseHandFile(JSON.stringify({ ...loose, to: 5 }))).toBeNull()
  expect(parseHandFile(JSON.stringify({ ...loose, hand: { id: 'x' } }))).toBeNull()
  expect(parseHandFile(JSON.stringify({ ...loose, hand: { ...h, text: '' } }))).toBeNull()
  expect(parseHandFile(JSON.stringify({ ...loose, hand: { ...h, typed: 'yes' } }))).toBeNull()
  expect(parseHandFile('nope')).toBeNull()
  expect(parseHandFile('[]')).toBeNull()
})

// ---- the forgery fence ----

test('touchesSonar: a model write into the sonar folder, by file tool or by shell, is caught', () => {
  const dir = 'c:/home/ada/.claude/state/witness-sonar'
  expect(touchesSonar('Write', { file_path: `${dir}/hands/abcd/h1.json` }, dir)).toBe(true)
  expect(touchesSonar('Edit', { file_path: 'C:\\Home\\ADA\\.claude\\state\\witness-sonar\\2026-10-09\\a.json' }, dir)).toBe(true)
  expect(touchesSonar('MultiEdit', { file_path: `${dir}/x.json` }, dir)).toBe(true)
  expect(touchesSonar('NotebookEdit', { notebook_path: `${dir}/x.ipynb` }, dir)).toBe(true)
  expect(touchesSonar('Write', { file_path: `${dir}/../witness-sonar/x.json` }, dir)).toBe(true)
  expect(touchesSonar('Write', { file_path: 'c:/home/ada/.claude/state/witness-usage/../witness-sonar/x.json' }, dir)).toBe(true)
  expect(touchesSonar('Bash', { command: 'echo {} > ~/.claude/state/witness-sonar/hands/a/b.json' }, dir)).toBe(true)
  expect(touchesSonar('PowerShell', { command: 'Set-Content C:\\Home\\ada\\.claude\\state\\WITNESS-SONAR\\x.json 1' }, dir)).toBe(true)
})

test('touchesSonar: other writes, reads and a missing folder are not caught', () => {
  const dir = 'c:/home/ada/.claude/state/witness-sonar'
  expect(touchesSonar('Write', { file_path: 'c:/p/alpha/a.ts' }, dir)).toBe(false)
  expect(touchesSonar('Write', { file_path: 'c:/home/ada/.claude/state/witness-usage/a.json' }, dir)).toBe(false)
  expect(touchesSonar('Write', { file_path: `${dir}-notes/a.md` }, dir)).toBe(false)
  expect(touchesSonar('Read', { file_path: `${dir}/a.json` }, dir)).toBe(false)
  expect(touchesSonar('Bash', { command: 'ls /tmp' }, dir)).toBe(false)
  expect(touchesSonar('Write', { file_path: `${dir}/a.json` }, null)).toBe(false)
  expect(touchesSonar('Bash', { command: 'cat witness-sonar' }, null)).toBe(false)
  expect(touchesSonar('Write', null, dir)).toBe(false)
  expect(touchesSonar('Write', { file_path: 7 }, dir)).toBe(false)
  expect(touchesSonar('Bash', 'witness-sonar', dir)).toBe(false)
})

// ---- display ----

test('fmtAge: seconds under a minute, minutes under an hour, then hours; negatives are zero', () => {
  expect(fmtAge(0)).toBe('0s')
  expect(fmtAge(59_999)).toBe('59s')
  expect(fmtAge(60_000)).toBe('1m')
  expect(fmtAge(59 * MIN + 59_000)).toBe('59m')
  expect(fmtAge(60 * MIN)).toBe('1h')
  expect(fmtAge(5 * 60 * MIN + 1)).toBe('5h')
  expect(fmtAge(-5000)).toBe('0s')
  expect(fmtAge(Number.NaN)).toBe('0s')
})

test('bandPods: nothing with no pods; the count; the count and the overlapping paths', () => {
  const o = (path: string, peer: string): Overlap => ({ path, peer, peerName: peer, at: 1 })
  expect(bandPods([], [])).toBe('')
  expect(bandPods([], [o('a', 'p')])).toBe('')
  expect(bandPods([beat()], [])).toBe('pods 1')
  expect(bandPods([beat(), beat({ sessionId: 'b' }), beat({ sessionId: 'c' })], [])).toBe('pods 3')
  expect(bandPods([beat(), beat({ sessionId: 'b' })], [o('a', 'p1'), o('a', 'p2'), o('b', 'p1')])).toBe('pods 2 !2')
})

test('podRows: 1-based rows in order, with age, asks, goals and the paths that overlap that pod', () => {
  const pods = [
    beat({ sessionId: 'abcd-1111', name: 'alpha', beatAt: T0 - 45_000, state: 'idle', asks: '2/3', goals: ['one', 'two'] }),
    beat({ sessionId: 'f00d-2222', name: 'blog', beatAt: T0 - 5 * MIN, state: 'ended' }),
  ]
  const ov: Overlap[] = [
    { path: 'c:/p/a.ts', peer: 'abcd-1111', peerName: 'alpha', at: 1 },
    { path: 'c:/p/b.ts', peer: 'abcd-1111', peerName: 'alpha', at: 1 },
    { path: 'c:/p/c.ts', peer: 'other', peerName: 'x', at: 1 },
  ]
  const rows = podRows(pods, ov, T0)
  expect(rows).toEqual([
    { index: 1, label: 'alpha abcd', state: 'idle', age: '45s', asks: '2/3', goals: ['one', 'two'], overlaps: ['c:/p/a.ts - alpha wrote it too', 'c:/p/b.ts - alpha wrote it too'] },
    { index: 2, label: 'blog f00d', state: 'ended', age: '5m', asks: '0/0', goals: [], overlaps: [] },
  ])
  expect(podRows([], [], T0)).toEqual([])
})

test('overlapText and newcomerText', () => {
  expect(overlapText({ path: 'c:/p/a.ts', peer: 'p', peerName: 'beta', at: 1 })).toBe('c:/p/a.ts - beta wrote it too')
  expect(newcomerText(beat({ name: 'alpha', sessionId: 'abcd-1111', goals: ['ship it', 'later'] }))).toBe('alpha abcd is live in this repo: ship it')
  expect(newcomerText(beat({ name: 'alpha', sessionId: 'abcd-1111', goals: [] }))).toBe('alpha abcd is live in this repo')
})

// ---- no mutation ----

const deepFreeze = <T>(v: T): T => {
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

test('no input is mutated: every function over frozen data returns without throwing', () => {
  const pod = deepFreeze(beat({ goals: ['g'], writes: [w('c:/p/alpha/a.ts', T0)] }))
  const pods = deepFreeze([pod, beat({ sessionId: 'b2', name: 'beta' })])
  const mine = deepFreeze([w('c:/p/alpha/a.ts', T0)])
  const ov = deepFreeze(overlaps({ mine, myRoot: 'c:/p/alpha', pods, home, now: T0 }))
  const h = deepFreeze(hand())
  const raw = deepFreeze([{ kind: 'file', target: 'c:/a', at: T0 }])
  const b = makeBeat({ sessionId: 's', cwd: '/a/b', root: '/a', startedAt: 1, now: 2, state: 'idle', goals: deepFreeze(['x']), asks: '', writes: mine })
  expect(b.writes).not.toBe(mine)
  expect(recentWrites(raw, T0).length).toBe(1)
  expect(livePods(pods, { now: T0, self: 'zzz' }).length).toBe(2)
  expect(freshOverlaps(ov, ov)).toEqual([])
  expect(newcomers([], pods, 'c:/p/alpha').length).toBe(2)
  expect(findPod(pods, '1')).toBe(pods[0])
  expect(bandPods(pods, ov)).toBe('pods 2 !1')
  expect(podRows(pods, ov, T0).length).toBe(2)
  expect(parseHand(handEnvelope(h), 1)).not.toBeNull()
  expect(parseHandFile(handFile(h, 'x', false))).not.toBeNull()
  expect(parseBeat(beatFile(pod))).toEqual(pod)
  expect(handPrompt(h, 'you').length).toBeGreaterThan(0)
})
