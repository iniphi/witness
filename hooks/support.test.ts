import { test, expect } from 'claude-code/testing'

import type { Ask } from '../types'
import {
  TACKLE_HEADER,
  WRAP_READ_HEADER,
  bindLog,
  claimable,
  freshAsks,
  isCloseCommand,
  isTacklePrompt,
  isWrapReadPrompt,
  logPath,
  logTouch,
  needsOpenCheck,
  sameFile,
  tacklePrompt,
  undone,
  withPrint,
  withoutQuoted,
  wrapReadPrompt,
} from './support'

test('/close, with or without arguments, is recognised so the print lands before the close reads the log', () => {
  expect(isCloseCommand('/close')).toBe(true)
  expect(isCloseCommand('  /close --light ')).toBe(true)
  expect(isCloseCommand('/closeoverseer')).toBe(false)
  expect(isCloseCommand('please /close')).toBe(false)
  expect(isCloseCommand('close the session')).toBe(false)
})

test('a /tackle prompt is recognised so its listed asks are never mined as new ones', () => {
  const text = tacklePrompt([
    { id: 'a', text: 'Fit the bubble', source: 'ask', state: 'open', claimId: null, at: 1 },
  ]) ?? ''
  expect(text.startsWith(TACKLE_HEADER)).toBe(true)
  expect(isTacklePrompt(text)).toBe(true)
  expect(isTacklePrompt(`  ${text}`)).toBe(true)
  expect(isTacklePrompt('/agile plan the mirror walk fix')).toBe(false)
  expect(isTacklePrompt('move the companion to the right')).toBe(false)
})

const ask = (id: string, text: string, state: Ask['state']): Ask => ({
  id,
  text,
  source: 'ask',
  state,
  claimId: state === 'claimed' ? 'c1' : null,
  at: 1,
})

test('tacklePrompt: an /agile run over the open and pale asks, never the witnessed or dropped', () => {
  const asks = [
    ask('a1', 'Move the heads up beside the shell', 'open'),
    ask('a2', 'Fit the bubble\nto its width', 'claimed'),
    ask('a3', 'Amend the spec', 'witnessed'),
    ask('a4', 'Dock along the top', 'dropped'),
  ]
  const text = tacklePrompt(asks) ?? ''
  const lines = text.split('\n')
  expect(lines[0]).toEqual('/agile Tackle the undone asks the witness holds for this session:')
  expect(lines[1]).toContain('First, before any agent')
  expect(lines[2]).toEqual('1. Move the heads up beside the shell')
  expect(lines[3]).toEqual('2. Fit the bubble to its width (claimed done, never verified: verify it or finish it)')
  expect(lines.length).toEqual(5)
  expect(lines[4]).toContain('Done means witnessed')
  expect(undone(asks).map(a => a.id)).toEqual(['a1', 'a2'])
})

// Bradley, S163: "the first thing should be a sweep and evidence gather to adversarially
// dismiss some of them straight off before deploying agents ... especially if it's in the
// context window already".
test('tacklePrompt opens with the sweep: dismiss on evidence first, agents only for what survives', () => {
  const line = (tacklePrompt([ask('a1', 'x', 'open')]) ?? '').split('\n')[1] ?? ''
  expect(line).toContain('sweep')
  expect(line).toContain('context window')
  expect(line).toContain('mcp__witness__confirm')
  expect(line).toContain('only what survives')
})

test('tacklePrompt is null when nothing is undone', () => {
  expect(tacklePrompt([])).toBeNull()
  expect(tacklePrompt([ask('a', 'x', 'witnessed'), ask('b', 'y', 'dropped')])).toBeNull()
})

// 1.1 retired logCandidates (the newest log touched since the start, found by listing the
// folder): two sessions in one repo converged on one log. The watch now binds by its own calls.
// Paths are built from parts: the export's leak test refuses a dated log path written whole.
const CWD = 'C:/Work/Proj'
const LOGS = `${CWD}/.claude/sessions`
const logAt = (name: string): string => `${LOGS}/${name}`

test('the watch binds to the log its own calls touched, never to the newest name in the folder', () => {
  const own = bindLog(null, { path: logAt('s-0900.md'), by: 'write' }, 1)
  expect(own).toEqual({ path: logAt('s-0900.md'), by: 'write', at: 1 })
  expect(bindLog(own, { path: logAt('s-1700.md'), by: 'read' }, 2)).toBe(own)
  expect(bindLog(own, { path: logAt('s-1700.md'), by: 'edit' }, 2)).toBe(own)
  // A newer log written while this one is open is not followed; once this one is closed it is (a /task after a /close).
  expect(bindLog(own, { path: logAt('s-1700.md'), by: 'write' }, 2, true)).toBe(own)
  expect(bindLog(own, { path: logAt('s-1700.md'), by: 'write' }, 3, false)).toEqual({ path: logAt('s-1700.md'), by: 'write', at: 3 })
})

test('a stronger touch binds: a Write outranks an Edit, which outranks a Read; one log keeps its stronger touch', () => {
  const read = bindLog(null, { path: logAt('a.md'), by: 'read' }, 1)
  const edit = bindLog(read, { path: logAt('b.md'), by: 'edit' }, 2)
  expect(edit).toEqual({ path: logAt('b.md'), by: 'edit', at: 2 })
  expect(bindLog(edit, { path: logAt('c.md'), by: 'edit' }, 3)).toBe(edit)
  expect(bindLog(edit, { path: logAt('a.md'), by: 'read' }, 3)).toBe(edit)
  const same = bindLog(read, { path: logAt('a.md').replace(/\//g, '\\').toLowerCase(), by: 'write' }, 4)
  expect(same).toEqual({ path: logAt('a.md'), by: 'write', at: 4 })
  expect(bindLog(same, { path: logAt('a.md'), by: 'read' }, 5)).toBe(same)
  expect(needsOpenCheck(same, { path: logAt('b.md'), by: 'write' })).toBe(true)
  expect(needsOpenCheck(same, { path: logAt('a.md'), by: 'write' })).toBe(false)
  expect(needsOpenCheck(edit, { path: logAt('a.md'), by: 'write' })).toBe(false)
  expect(needsOpenCheck(null, { path: logAt('a.md'), by: 'write' })).toBe(false)
})

test('logTouch: a Write, Edit or Read of a .md directly under the sessions folder, in any path form', () => {
  const touch = (tool: string, file_path: unknown) => logTouch(tool, { file_path }, CWD)
  expect(touch('Write', logAt('s-main.md'))).toEqual({ path: logAt('s-main.md'), by: 'write' })
  expect(touch('Edit', logAt('s-main.md').replace(/\//g, '\\'))).toEqual({ path: logAt('s-main.md'), by: 'edit' })
  expect(touch('Read', logAt('s-main.md').toLowerCase())).toEqual({ path: logAt('s-main.md').toLowerCase(), by: 'read' })
  expect(touch('Write', logAt('s-main.md').replace('C:/', '/c/'))).toEqual({ path: logAt('s-main.md'), by: 'write' })
  expect(touch('Write', '.claude/sessions/s-main.md')).toEqual({ path: logAt('s-main.md'), by: 'write' })
  expect(logTouch('Write', { file_path: `${CWD}/logs/s-main.md` }, CWD, 'logs')).toEqual({ path: `${CWD}/logs/s-main.md`, by: 'write' })
})

test('logTouch binds nothing for a nested folder, another folder, another kind of file or another tool', () => {
  const touch = (tool: string, file_path: unknown) => logTouch(tool, { file_path }, CWD)
  expect(touch('Write', `${LOGS}/old/s-main.md`)).toBeNull()
  expect(touch('Write', `${CWD}/.claude/sessions-old/s-main.md`)).toBeNull()
  expect(touch('Write', logAt('s-main.txt'))).toBeNull()
  expect(touch('Write', logAt('.md'))).toBeNull()
  expect(touch('Write', LOGS)).toBeNull()
  expect(touch('Bash', logAt('s-main.md'))).toBeNull()
  expect(touch('NotebookEdit', logAt('s-main.md'))).toBeNull()
  expect(touch('constructor', logAt('s-main.md'))).toBeNull()
  expect(touch('Write', 42)).toBeNull()
  expect(touch('Write', '   ')).toBeNull()
})

test('logPath gives the fs a usable path; sameFile ignores case, slashes and the Git Bash form', () => {
  expect(logPath('C:\\Work\\Proj\\x\\..\\a.md', CWD)).toEqual('C:/Work/Proj/a.md')
  expect(logPath('/c/Work/Proj/a.md', CWD)).toEqual('C:/Work/Proj/a.md')
  // Off Windows, /c/ is an ordinary folder.
  expect(logPath('/c/work/a.md', '/home/u/proj')).toEqual('/c/work/a.md')
  expect(sameFile('C:\\Work\\Proj\\a.md', '/c/work/proj/A.MD')).toBe(true)
  expect(sameFile(logAt('a.md'), logAt('b.md'))).toBe(false)
})

test('withPrint replaces only up to the end marker, so notes after a first print survive', () => {
  const first = '# Log\n\n## Witness print\nold\n<!-- /witness print -->\n\n## Notes\nkept\n'
  const next = withPrint(first, '## Witness print\nnew\n<!-- /witness print -->')
  expect(next).toContain('new')
  expect(next).not.toContain('old')
  expect(next).toContain('## Notes\nkept')
  expect(withPrint('# Log\n', '## Witness print\nx\n<!-- /witness print -->')).toEqual(
    '# Log\n\n## Witness print\nx\n<!-- /witness print -->\n',
  )
})

// Bradley, 2026-10-08: /wrap printed the watch into the log, but the main session never read it.
test('wrapReadPrompt hands the print to the main session to settle, starting no new work', () => {
  const print = '## Witness print\n\nAsks: 1 of 2 witnessed, 1 pale, 0 open.\n\n- [x] fix band\n- [ ] add pane (pale: claimed, never witnessed)'
  const p = wrapReadPrompt(print, '/work/proj/logs/2026-10-08-1036.md')
  expect(p.split('\n')[0]).toEqual(WRAP_READ_HEADER)
  expect(isWrapReadPrompt(p)).toBe(true)
  expect(isWrapReadPrompt('please read the print')).toBe(false)
  expect(p).toContain(print)
  expect(p).toContain('2026-10-08-1036.md')
  expect(p).toContain('mcp__witness__confirm')
  expect(p).toContain('outcome "dropped"')
  expect(p).toContain('Start no new work')
  expect(wrapReadPrompt(print, null)).toContain('not written to a session log')
})

// A field report (405_85labs): "Set up a dedicated GCP project" needs Bradley's own login
// and billing, and /tackle offered it to an /agile actor.
test('tacklePrompt leaves for Bradley what needs his own hands', () => {
  const p = tacklePrompt([ask('o', 'Set up a dedicated GCP project', 'open')])!
  expect(p.split('\n').pop()).toContain('needs my own hands')
})

test('an ask the close triage made a to-do is not undone work, nor put into /tackle', () => {
  const routed: Ask = { ...ask('t', 'Complete the Stripe Connect build', 'open'), settled: 'to-do' }
  expect(undone([routed, ask('o', 'Fix the band', 'open')]).map(a => a.id)).toEqual(['o'])
  expect(tacklePrompt([routed])).toEqual(null)
})

// 1.3.7 (ruled by Bradley 2026-10-11: "quoted, no ask"): an Ammonite heckle sent on with its
// case is the Ammonite's words. Its last point says what to do and must never become his ask.
const SENT_CASE = [
  'The Ammonite objects: "Cutting the case as pasted text leaves the objection untracked."',
  '**Untracked objections get silently dropped**',
  '- **"Quoted, no ask"** records nothing from the case.',
  '- Before relying on it, paste the heckle once and confirm it.',
].join('\n')

test('withoutQuoted cuts a sent Ammonite heckle and its case, keeping his own words around it', () => {
  const alone = withoutQuoted(SENT_CASE)
  expect(alone.includes('paste the heckle once')).toEqual(false)
  expect(alone.includes('Untracked objections')).toEqual(false)
  expect(alone).toContain("[the Ammonite's objection]")
  const framed = withoutQuoted(`what do you make of this?\n${SENT_CASE}\nand please fix the README after`)
  expect(framed).toContain('what do you make of this?')
  expect(framed).toContain('please fix the README after')
  expect(framed.includes('confirm it')).toEqual(false)
  // The heckle alone (no case), his words after it on the same line.
  const inline = withoutQuoted('The Ammonite objects: "It fails offline." and I agree, rethink the cache.')
  expect(inline).toContain('and I agree, rethink the cache.')
  expect(inline.includes('It fails offline')).toEqual(false)
  // Without the prefix it is ordinary text.
  expect(withoutQuoted('- Before relying on it, paste the heckle once.')).toContain('paste the heckle once')
})

// Seen live 2026-10-08 (Overseer S166): Bradley pasted 405_85labs' /tackle prompt to talk
// about it, and the witness minted five of 85labs' asks as his asks in this session.
test('withoutQuoted cuts pasted blocks and a quoted /tackle prompt, keeping his own words', () => {
  const pasted = [
    'i think some of these prompts are a little difficult:',
    '<pasted_content id="6f73">',
    `${TACKLE_HEADER}`,
    '1. Build 18 fictional apps',
    '</pasted_content id="6f73">',
    'maybe we need to tone down the recording?',
  ].join('\n')
  const out = withoutQuoted(pasted)
  expect(out.includes('Build 18 fictional apps')).toEqual(false)
  expect(out).toContain('a little difficult')
  expect(out).toContain('tone down the recording')
  const bare = [
    'look at this:',
    TACKLE_HEADER,
    '1. Complete the Stripe Connect build',
    'Done means witnessed: close each item with a read-back.',
    'should we change it?',
  ].join('\n')
  const cut = withoutQuoted(bare)
  expect(cut.includes('Stripe Connect')).toEqual(false)
  expect(cut).toContain('look at this:')
  expect(cut).toContain('should we change it?')
  expect(withoutQuoted('fix the band')).toEqual('fix the band')
})

test('a build is never claimed by a done answer nor put into /tackle', () => {
  const b: Ask = { ...ask('b', 'Rebuild 85labs to a shippable standard', 'open'), source: 'build' }
  const o = ask('o', 'Fix the band', 'open')
  expect(claimable([b, o]).map(a => a.id)).toEqual(['o'])
  expect(undone([b, o]).map(a => a.id)).toEqual(['o'])
  expect(tacklePrompt([b])).toEqual(null)
  expect(freshAsks(['Rebuild 85labs'], ['i'], 5, 'build')[0]!.source).toEqual('build')
  expect(freshAsks(['Fix the band'], ['j'], 5)[0]!.source).toEqual('ask')
})
