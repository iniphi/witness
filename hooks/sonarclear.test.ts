import { test, expect, mock } from 'claude-code/testing'

// F2 (2026-10-09, seen live): after a /clear the previous conversation's heartbeat was left
// `working`. The engine's types (SessionEndInput) say a /clear fires session.end with reason
// `clear`, the process goes on under a new session id, and no session.start fires for it; the
// end chain shares one short wall-clock bound. So the pod must end its old beat without waiting
// on its other saves, and follow the new id itself. Plugin tests fake the engine: the live look
// (a /clear in a real pod, then /pods from another) is still owed.

const DAY = Date.UTC(2026, 9, 9, 15, 0)
const START = { cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true } as const
const SONAR = 'c:/home/u/.claude/state/witness-sonar'
const TODAY = '2026-10-09'

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const beatOf = (files: Map<string, string>, id: string): any => {
  const text = files.get(`${SONAR}/${TODAY}/${id}.json`)
  return text === undefined ? undefined : JSON.parse(text)
}

/** A fake engine: files in memory, a store the test can read, the session id the test sets. */
function world(on: any, files: Map<string, string>, id: () => string, store: Map<string, unknown>, failKey?: RegExp): { clock: any } {
  const clock = mock.clock(on, { now: DAY })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => {
    if (failKey !== undefined && failKey.test(String(e.key))) throw new Error('store refused')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, { USERPROFILE: 'C:\\Home\\u' })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: id() }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('session.id', () => ({ value: id() }))
  on('session.usage', () => ({ value: { startedAt: DAY, context: { tokens: 52_000, window: 200_000 } } }))
  on('session.repo', () => ({ value: { root: 'C:/work/proj', remote: null, internal: false, name: null } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', (_$: any, e: any) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$: any, e: any) => {
    files.set(norm(e.path), String(e.text))
    return { value: undefined }
  })
  on('fs.list', (_$: any, e: any) => {
    const dir = `${norm(e.path).replace(/\/+$/, '')}/`
    const names = [...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length))
    const entries = [...new Set(names.map(n => n.split('/')[0]!))].map(name => ({
      name,
      kind: names.includes(name) ? 'file' : 'dir',
      size: 1,
      mtimeMs: 0,
      isLink: false,
    }))
    return { value: entries }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"asks": [], "builds": []}' } }))
  return { clock }
}

test('a /clear ends the old beat and the pod follows the new id (F2)', { timeoutMs: 15_000, options: { sonar: 'on' } }, async ($, on) => {
  const files = new Map<string, string>()
  let sid = 'old-111111'
  const { clock } = world(on, files, () => sid, new Map())
  await $.session.start(START)
  await clock.advance(1)
  expect(beatOf(files, 'old-111111')?.state).toBe('idle')
  sid = 'new-222222'
  await $.session.end({ reason: 'clear' } as any)
  expect(beatOf(files, 'old-111111')?.state).toBe('ended')
  expect(beatOf(files, 'new-222222')?.state).toBe('idle')
  // The next turn is the new conversation's: the old beat stays ended, never resurrected.
  await $.turn.start({ turnId: 't1' } as any)
  expect(beatOf(files, 'new-222222')?.state).toBe('working')
  expect(beatOf(files, 'old-111111')?.state).toBe('ended')
})

test('an exit ends the beat and follows nothing', { options: { sonar: 'on' } }, async ($, on) => {
  const files = new Map<string, string>()
  let sid = 'old-111111'
  const store = new Map<string, unknown>()
  const { clock } = world(on, files, () => sid, store)
  await $.session.start(START)
  await clock.advance(1)
  sid = 'other-333333'
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  expect(beatOf(files, 'old-111111')?.state).toBe('ended')
  expect(beatOf(files, 'other-333333')).toBeUndefined()
  // The leftovers are marked ended under the session that ended.
  const slot: any = [...store.entries()].find(([k]) => String(k).startsWith('carry:') && String(k).endsWith('old-111111'))?.[1]
  expect(slot?.ended).toBe(true)
})

test('a save that fails at the end does not keep the ended beat from being written', { options: { sonar: 'on' } }, async ($, on) => {
  const files = new Map<string, string>()
  const { clock } = world(on, files, () => 'old-111111', new Map(), /^carry:/)
  await $.session.start(START)
  await clock.advance(1)
  await Promise.resolve($.session.end({ reason: 'other' } as any)).catch(() => undefined)
  expect(beatOf(files, 'old-111111')?.state).toBe('ended')
})
