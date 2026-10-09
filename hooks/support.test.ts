import { test, expect } from 'claude-code/testing'

import type { Ask } from '../types'
import {
  TACKLE_HEADER,
  WRAP_READ_HEADER,
  claimable,
  freshAsks,
  isCloseCommand,
  isTacklePrompt,
  isWrapReadPrompt,
  logCandidates,
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

test('logCandidates keeps only logs touched since the session started, newest first', () => {
  const start = 1_000_000_000
  const entries = [
    { name: '2026-09-20-1748.md', kind: 'file', mtimeMs: start - 17 * 86_400_000 },
    { name: '2026-10-07-1630.md', kind: 'file', mtimeMs: start + 60_000 },
    { name: '2026-10-07-1146.md', kind: 'file', mtimeMs: start - 3 * 3_600_000 },
    { name: 'notes.txt', kind: 'file', mtimeMs: start },
  ]
  expect(logCandidates(entries, start)).toEqual(['2026-10-07-1630.md'])
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
