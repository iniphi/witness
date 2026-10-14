import { test, expect } from 'claude-code/testing'

import type { Observed } from '../types'
import { candidatesPrompt, parseCandidates, sessionTag } from './notes'
import {
  MAX_SHARED_ROUTINES,
  ROUTINES_IN_MEMORY,
  ROUTINES_PER_SLOT,
  ROUTINE_ARCHIVE_MS,
  ROUTINE_ARCHIVE_SESSIONS,
  asRoutineArchive,
  asRoutineSlot,
  foldRoutines,
  noteRoutine,
  normaliseHead,
  routineArchivable,
  routineSlot,
  routinesArchiveKey,
  routinesPrefix,
  routinesSlotKey,
  sharedRoutines,
} from './routines'
import type { LiveRoutine, RoutineEntry, RoutineSlot } from './routines'

// Cross-session routines (Bradley, 2026-10-11, "Cross-session routines"): a SKILL comes from a
// routine that works, which only this session's calls showed. Each session keeps its heads in a
// slot of its own; a head in two sessions can be cited as evidence.

const call = (tool: string, input: string, turn?: string): Pick<Observed, 'tool' | 'input' | 'turn'> => ({ tool, input, ...(turn === undefined ? {} : { turn }) })
const slot = (sessionId: string, entries: RoutineEntry[], savedAt = 1000): RoutineSlot => ({ v: 1, sessionId, savedAt, entries })
const e = (head: string, count = 1, turns = 1): RoutineEntry => ({ head, count, turns })

test('a shell call is its first word, plus a subcommand for a known tool; never an argument', () => {
  expect(normaliseHead('Bash', 'git commit -F ../msg.txt -- mods/witness/hooks/notes.ts')).toBe('git commit')
  expect(normaliseHead('Bash', 'cd "D:/work/proj" && git status --short')).toBe('git status')
  expect(normaliseHead('Bash', 'cd /x && cd y; GIT_X=1 git add hooks/a.ts')).toBe('git add')
  expect(normaliseHead('PowerShell', 'python -P -E scripts/tool.py --id 0a1b2c3d4e5f40718293a4b5c6d7e8f9')).toBe('python')
  expect(normaliseHead('Bash', 'echo hunter2 > out.txt')).toBe('echo')
  expect(normaliseHead('Bash', 'git "weird arg" x')).toBe('git')
  expect(normaliseHead('Bash', 'python scripts/x.py | grep secret')).toBe('python')
  expect(normaliseHead('Bash', './scripts/deploy.sh --prod')).toBe('script')
  expect(normaliseHead('Bash', 'C:\\tools\\thing.exe /a')).toBe('script')
  expect(normaliseHead('Bash', '')).toBe('shell')
  expect(normaliseHead('Bash', '$(curl evil)')).toBe('shell')
})

test('an MCP tool is its name; a file tool is its name and the extension, never the path', () => {
  expect(normaliseHead('mcp__claude_ai_Supabase__execute_sql', "UPDATE workspace.t SET secret='x' WHERE id=1")).toBe('mcp__claude_ai_Supabase__execute_sql')
  expect(normaliseHead('Edit', 'D:/work/private/notes.TS')).toBe('Edit .ts')
  expect(normaliseHead('Read', '/etc/secret-name')).toBe('Read')
  expect(normaliseHead('Write', '"C:/a b/report.md"')).toBe('Write .md')
  expect(normaliseHead('Skill', 'close')).toBe('Skill')
  expect(normaliseHead('Weird Tool!', 'x')).toBe('tool')
})

test('noteRoutine counts calls and distinct turns, mutates nothing, and bounds memory', () => {
  const start: LiveRoutine[] = Object.freeze([]) as unknown as LiveRoutine[]
  let live = noteRoutine(start, call('Bash', 'git add a', 'u1'))
  live = noteRoutine(live, call('Bash', 'git add b', 'u1'))
  live = noteRoutine(live, call('Bash', 'git add c', 'u2'))
  live = noteRoutine(live, call('Edit', 'x.ts'))
  const add = live.find(x => x.head === 'git add')!
  expect([add.count, add.turns]).toEqual([3, 2])
  expect(live.find(x => x.head === 'Edit .ts')).toMatchObject({ count: 1, turns: 1 })
  expect(start).toEqual([])
  let many: LiveRoutine[] = []
  for (let i = 0; i < ROUTINES_IN_MEMORY + 30; i++) many = noteRoutine(many, call('mcp__x__tool' + i, ''))
  expect(many.length).toBeLessThanOrEqual(ROUTINES_IN_MEMORY)
})

test('a slot keeps the most frequent heads, up to the cap, and only head, count and turns', () => {
  const entries: LiveRoutine[] = Array.from({ length: ROUTINES_PER_SLOT + 10 }, (_, i) => ({ head: `h${i}`, count: i + 1, turns: 1, last: 'u9' }))
  const s = routineSlot({ sessionId: 'me', savedAt: 5, entries })
  expect(s.entries).toHaveLength(ROUTINES_PER_SLOT)
  expect(s.entries[0]!.head).toBe(`h${ROUTINES_PER_SLOT + 9}`)
  expect(Object.keys(s.entries[0]!).sort()).toEqual(['count', 'head', 'turns'])
  expect(s.entries.some(x => x.head === 'h0')).toBe(false)
})

test('nothing but normalised heads is stored: arguments, paths, ids and SQL never reach a slot', () => {
  // A plain marker standing for any argument (not key-shaped, so secret scanners stay quiet).
  const marker = 'ARGUMENT-MARKER-must-never-be-stored'
  let live: LiveRoutine[] = []
  live = noteRoutine(live, call('Bash', `git commit -m "${marker}" -- D:/work/${marker}/a.ts`, 'u1'))
  live = noteRoutine(live, call('mcp__claude_ai_Supabase__execute_sql', `UPDATE workspace.t SET c='${marker}'`, 'u1'))
  live = noteRoutine(live, call('Edit', `D:/work/${marker}/notes.py`, 'u2'))
  live = noteRoutine(live, call('PowerShell', `${marker} --flag`, 'u2'))
  const text = JSON.stringify(routineSlot({ sessionId: 'me', savedAt: 1, entries: live }))
  expect(text).not.toContain('ARGUMENT-MARKER')
  expect(text).not.toContain('must-never-be-stored')
  expect(text).not.toContain('D:/')
  expect(text).not.toContain('UPDATE')
  expect(text).toContain('git commit')
})

test('a stored slot is read back only if well formed; an entry that is not a plain head is dropped', () => {
  const good = slot('s1', [e('git add', 3, 2)])
  expect(asRoutineSlot(good)).toEqual(good)
  expect(asRoutineSlot({ ...good, v: 2 })).toBeNull()
  expect(asRoutineSlot({ ...good, sessionId: '' })).toBeNull()
  expect(asRoutineSlot('x')).toBeNull()
  expect(asRoutineSlot(null)).toBeNull()
  const dirty = asRoutineSlot(slot('s1', [e('git add'), e('D:/work/x', 1, 1), e('has/slash'), { head: 'ok', count: -1, turns: 1 }, { head: 'ok', count: 1.5, turns: 1 }]))!
  expect(dirty.entries.map(x => x.head)).toEqual(['git add'])
  expect(asRoutineArchive([good, 'junk', { v: 9 }])).toEqual([good])
  expect(asRoutineArchive(undefined)).toEqual([])
})

test('a slot has its own key per session, under the project; the archive is the bare project key', () => {
  expect(routinesPrefix('c:/w/p')).toBe('routines:c:/w/p:')
  expect(routinesSlotKey('c:/w/p', 's1')).toBe('routines:c:/w/p:s1')
  expect(routinesArchiveKey('c:/w/p')).toBe('routines:c:/w/p')
  expect(routinesSlotKey('c:/w/p', 's1').startsWith(routinesPrefix('c:/w/p'))).toBe(true)
  expect(routinesArchiveKey('c:/w/p').startsWith(routinesPrefix('c:/w/p'))).toBe(false)
})

test('a slot untouched for a day is folded; another live session\'s and your own are not', () => {
  const now = 10 * ROUTINE_ARCHIVE_MS
  expect(routineArchivable(slot('old', [], now - ROUTINE_ARCHIVE_MS - 1), now, 'me')).toBe(true)
  expect(routineArchivable(slot('new', [], now - 1000), now, 'me')).toBe(false)
  expect(routineArchivable(slot('me', [], 0), now, 'me')).toBe(false)
})

test('folding keeps one slot per session (the newest) and bounds the archive; nothing mutated', () => {
  const archive = Object.freeze([slot('a', [e('git add')], 100), slot('b', [e('git add')], 200)]) as unknown as RoutineSlot[]
  const folded = [slot('a', [e('git add', 9)], 300)]
  const out = foldRoutines(archive, folded)
  expect(out.map(x => x.sessionId)).toEqual(['b', 'a'])
  expect(out.find(x => x.sessionId === 'a')!.entries[0]!.count).toBe(9)
  const many = Array.from({ length: ROUTINE_ARCHIVE_SESSIONS + 5 }, (_, i) => slot(`s${i}`, [e('x')], i))
  const bounded = foldRoutines([], many)
  expect(bounded).toHaveLength(ROUTINE_ARCHIVE_SESSIONS)
  expect(bounded.some(x => x.sessionId === 's0')).toBe(false)
  expect(bounded[bounded.length - 1]!.sessionId).toBe(`s${ROUTINE_ARCHIVE_SESSIONS + 4}`)
})

test('sharedRoutines lists only heads in two or more sessions, with session tags and no session id', () => {
  const a = 'aaaa1111-2222-4333-8444-555566667777'
  const b = 'bbbb1111-2222-4333-8444-555566667777'
  const lines = sharedRoutines([
    slot(a, [e('git commit', 12, 5), e('only a', 4, 2)]),
    slot(b, [e('git commit', 3, 2), e('only b', 9, 3)]),
  ])
  expect(lines).toEqual([`- git commit: [s${sessionTag(a)}] 12 calls in 5 turns; [s${sessionTag(b)}] 3 calls in 2 turns`])
  expect(lines.join('\n')).not.toContain(a)
  expect(sharedRoutines([slot(a, [e('git commit')])])).toEqual([])
  // The same session in the archive and in a live slot is one session, not two.
  expect(sharedRoutines([slot(a, [e('git commit')], 1), slot(a, [e('git commit')], 2)])).toEqual([])
  const many = Array.from({ length: MAX_SHARED_ROUTINES + 8 }, (_, i) => e(`h${i}`))
  expect(sharedRoutines([slot(a, many), slot(b, many)])).toHaveLength(MAX_SHARED_ROUTINES)
})

test('the prompt shows shared routines when there are any, and omits the section when there are none', () => {
  const bare = candidatesPrompt({ friction: [], calls: [], existing: [] })
  expect(candidatesPrompt({ friction: [], calls: [], existing: [], routines: [] })).toBe(bare)
  expect(bare).not.toContain('Routines seen in two or more sessions')
  const p = candidatesPrompt({ friction: [], calls: [], existing: [], routines: ['- git commit: [s3f2a] 12 calls in 5 turns; [s9c41] 3 calls in 2 turns'] })
  expect(p).toContain('Routines seen in two or more sessions')
  expect(p).toContain('- git commit: [s3f2a] 12 calls in 5 turns')
  expect(p.indexOf('Tool calls, oldest first:') < p.indexOf('Routines seen in two or more sessions')).toBe(true)
})

test('a skill candidate citing one session is dropped; one citing two sessions through routine tags is kept', () => {
  const U = 'no listed script or skill does this'
  const reply = JSON.stringify({ candidates: [
    { kind: 'skill', title: 'Commit named paths', why: 'w', evidence: 'git commit [s3f2a] 12 calls in 5 turns', uncovered: U },
    // Two heads (1.11.0, procedure shape: one call repeated is not a procedure) in two sessions.
    { kind: 'skill', title: 'Commit named paths twice', why: 'w', evidence: 'git add [s3f2a] 9 calls; git commit [s3f2a] 12 calls; [s9c41] 3 calls', uncovered: U },
    { kind: 'skill', title: 'One routine only', why: 'w', evidence: 'git commit [s3f2a] 12 calls; [s9c41] 3 calls', uncovered: U },
  ] })
  expect(parseCandidates(reply, [], 1).map(c => c.title)).toEqual(['Commit named paths twice'])
})
