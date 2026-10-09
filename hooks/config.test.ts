import { test, expect } from 'claude-code/testing'

import {
  DEFAULT_WRITERS,
  isCloseCommand,
  listOf,
  normalizePath,
  onWords,
  personRef,
  readConfig,
  scriptCandidates,
  sonarOn,
  typedHandsStart,
  writerPattern,
} from './config'
import { parseGoals, PRINT_END } from './asks'
import { confirmDescription, confirmSchema } from './evidence'
import { writerCalls } from './sql'
import {
  TACKLE_HEADER,
  TACKLE_TITLE,
  isTacklePrompt,
  sessionsDir,
  tacklePrompt,
  withoutQuoted,
  wrapReadPrompt,
} from './support'
import { usageDir } from './usage'

const ask = (id: string, text: string) => ({ id, text, source: 'ask' as const, state: 'open' as const, claimId: null, at: 1 })

test('with no options the defaults are the estate: its writers, .claude/sessions, ## Goals, /close, you', () => {
  const c = readConfig(undefined)
  expect(c.ticketScript).toEqual('')
  expect(c.watchScript).toEqual('')
  expect(c.writers).toEqual([...DEFAULT_WRITERS])
  expect([c.sessionsDir, c.goalsHeading, c.closeCommands, c.person]).toEqual(['.claude/sessions', '## Goals', ['/close'], 'you'])
})

test('options override each default; blank values fall back', () => {
  const c = readConfig({ writerCalls: 'app.finish_task, app.log_*', closeCommands: '/wrapup,\n/end', person: 'Ada', sessionsDir: ' ', goalsHeading: '### Aims' })
  expect(c.writers).toEqual(['app.finish_task', 'app.log_*'])
  expect(c.closeCommands).toEqual(['/wrapup', '/end'])
  expect([c.person, c.sessionsDir, c.goalsHeading]).toEqual(['Ada', '.claude/sessions', '### Aims'])
  expect(listOf(' , a ,, b ')).toEqual(['a', 'b'])
})

test('the sonar runs where the estate is by default, and on or off when set (1.2)', () => {
  expect(readConfig(undefined).sonar).toEqual('auto')
  expect(readConfig({ sonar: 'on' }).sonar).toEqual('on')
  expect(readConfig({ sonar: 'loud' }).sonar).toEqual('auto')
  expect([sonarOn('auto', true), sonarOn('auto', false), sonarOn('on', false), sonarOn('off', true)]).toEqual([true, false, true, false])
})

// Ruled 2026-10-09: typed hands wait for Enter by default; they start work unattended only where
// the estate is found (auto) or when set to start.
test('typed hands start work only where the estate is, or when set to start', () => {
  expect(readConfig(undefined).typedHands).toEqual('auto')
  expect(readConfig({ typedHands: 'start' }).typedHands).toEqual('start')
  expect(readConfig({ typedHands: 'wait' }).typedHands).toEqual('wait')
  expect(readConfig({ typedHands: 'yes' }).typedHands).toEqual('auto')
  expect([
    typedHandsStart('auto', true),
    typedHandsStart('auto', false),
    typedHandsStart('start', false),
    typedHandsStart('wait', true),
  ]).toEqual([true, false, true, false])
})

test('paths normalise: backslashes, dot segments, a drive kept', () => {
  expect(normalizePath('C:\\a\\b\\..\\c\\.\\d\\')).toEqual('C:/a/c/d')
  expect(normalizePath('/x/y/../../z')).toEqual('/z')
  expect(normalizePath('C:/a/../../b')).toEqual('C:/b')
})

test('a default script is looked for in the mod folder and up to its repository root, never the session folder', () => {
  const found = scriptCandidates('', 'C:/py/estate/mods/witness', 'C:/work/proj', 'scripts/estate-status.py')
  expect(found).toEqual([
    'C:/py/estate/mods/witness/scripts/estate-status.py',
    'C:/py/estate/mods/scripts/estate-status.py',
    'C:/py/estate/scripts/estate-status.py',
  ])
  expect(found.some(p => p.startsWith('C:/work/proj'))).toBe(false)
  expect(scriptCandidates('', '', 'C:/work/proj', 'scripts/x.py')).toEqual([])
})

test('a configured script is the only candidate, relative to the session folder or absolute', () => {
  expect(scriptCandidates('tools/ticket.py', 'C:/mod', 'C:/work/proj', 'scripts/x.py')).toEqual(['C:/work/proj/tools/ticket.py'])
  expect(scriptCandidates('D:\\t\\ticket.py', 'C:/mod', 'C:/work/proj', 'scripts/x.py')).toEqual(['D:/t/ticket.py'])
})

test('the default writer pattern finds what the estate list names; a custom list replaces it; none finds none', () => {
  const q = "SELECT workspace.close_todo('x'), workspace.crosstalk_resolve(1), app.finish_task(2)"
  expect(writerCalls(q, writerPattern([...DEFAULT_WRITERS]))).toEqual(['workspace.close_todo', 'workspace.crosstalk_resolve'])
  expect(writerCalls(q, writerPattern(['app.finish_*']))).toEqual(['app.finish_task'])
  expect(writerPattern([])).toBeNull()
  expect(writerCalls(q, null)).toEqual([])
  expect(writerPattern(['bad name;'])).toBeNull()
})

test('close commands come from config', () => {
  expect(isCloseCommand('/close --light', ['/close'])).toBe(true)
  expect(isCloseCommand('/closeoverseer', ['/close'])).toBe(false)
  expect(isCloseCommand('/end', ['/wrapup', '/end'])).toBe(true)
  expect(isCloseCommand('/close', ['/end'])).toBe(false)
})

test('the person: "the user" and "your words" by default, else the configured name', () => {
  expect([personRef('you'), onWords('you')]).toEqual(['the user', 'on your words'])
  expect([personRef('Ada'), onWords('Ada')]).toEqual(['Ada', "on Ada's words"])
  expect(confirmDescription('you')).toContain('only the user can witness')
  expect(confirmDescription('Ada')).toContain('only Ada can witness')
  expect(JSON.stringify(confirmSchema('you'))).toContain('"enum":["call","user"]')
  expect(JSON.stringify(confirmSchema('you'))).not.toContain('bradley')
  expect(wrapReadPrompt('print', null, 'Ada', '/end')).toContain('if Ada called it off')
  expect(wrapReadPrompt('print', null, 'Ada', '/end')).toContain('Builds stay for /end')
})

test('a generic /tackle names no skill; the estate one is /agile; both are recognised and cut when quoted', () => {
  const generic = tacklePrompt([ask('a1', 'Fix the walker')], null) ?? ''
  expect(generic.startsWith(TACKLE_TITLE)).toBe(true)
  expect(generic).not.toContain('/agile')
  expect(isTacklePrompt(generic)).toBe(true)
  expect((tacklePrompt([ask('a1', 'x')]) ?? '').startsWith(TACKLE_HEADER)).toBe(true)
  expect(isTacklePrompt(TACKLE_HEADER)).toBe(true)
  const quoted = withoutQuoted(`look at this: ${generic}\nand tell me`)
  expect(quoted).not.toContain('Fix the walker')
  expect(withoutQuoted(`see ${TACKLE_HEADER}\n1. x\nDone means witnessed: y\nok`)).not.toContain('/agile')
})

test('the goals heading and the sessions folder come from config', () => {
  const log = '# Log\n\n### Aims\n- [ ] one\n#### detail\n- [x] two\n### Notes\n- [ ] not a goal\n## Goals\n- [ ] also not\n'
  expect(parseGoals(log, '### Aims').map(g => g.text)).toEqual(['one', 'two'])
  expect(parseGoals(log).map(g => g.text)).toEqual(['also not'])
  expect(sessionsDir('C:\\work\\proj\\', 'notes/sessions')).toEqual('C:/work/proj/notes/sessions')
  expect(sessionsDir('C:/work/proj')).toEqual('C:/work/proj/.claude/sessions')
  expect(PRINT_END.length > 0).toBe(true)
})

test('usage files live under the home folder, and are not written when the home is unknown', () => {
  expect(usageDir('C:\\Home\\u\\')).toEqual('C:/Home/u/.claude/state/witness-usage')
  expect(usageDir(undefined)).toBeNull()
  expect(usageDir('  ')).toBeNull()
})
