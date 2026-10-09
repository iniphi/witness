import { test, expect } from 'claude-code/testing'
import type { Candidate, OpenFailure, RepairPair } from '../types'
import {
  KIND_BY_CODE,
  MAX_DIFF_TOKENS,
  PAIR_TEXT_MAX,
  REPAIRS_KEPT,
  REPAIR_WINDOW_CALLS,
  REPAIR_WINDOW_MS,
  age,
  antigenOf,
  cure,
  diffOf,
  epitope,
  errorClass,
  estTokens,
  hits,
  inputLine,
  noteFailure,
  shortTool,
  sqlState,
  targetsOf,
} from './repair'
// Memory, candidates and lines moved to immunity.ts when repair.ts passed 400 lines (S170).
import { addPairs, asPairs, memory, pairCandidates, pairLine, pairsSection } from './immunity'

const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const NOTION_UPDATE = 'mcp__claude_ai_Notion__notion-update-page'
const NOTION_FETCH = 'mcp__claude_ai_Notion__notion-fetch'
const BAD = "UPDATE workspace.todo_mirror SET statuss='Done' WHERE id='x'"
const GOOD = "UPDATE workspace.todo_mirror SET status='Done' WHERE id='x'"
const ERR_COL = 'ERROR: 42703: column "statuss" of relation "todo_mirror" does not exist'
const PAGE = '0a1b2c3d4e5f40718293a4b5c6d7e8f9'
const PAGE_DASHED = '0a1b2c3d-4e5f-4071-8293-a4b5c6d7e8f9'
const KEY = '42703|workspace.todo_mirror.statuss'

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    Object.freeze(v)
    for (const k of Object.values(v as Record<string, unknown>)) deepFreeze(k)
  }
  return v
}

const open = (over: Partial<OpenFailure> = {}): OpenFailure => ({
  key: 'other|Bash',
  antigen: { tool: 'Bash', code: 'other', kind: 'other', target: 'Bash', fragment: '', reason: 'boom' },
  targets: ['Bash'],
  attempts: 1,
  cost: 10,
  lastTool: 'Bash',
  lastInput: 'false',
  firstAt: 0,
  lastAt: 0,
  since: 0,
  ...over,
})

const pair = (over: Partial<RepairPair> = {}): RepairPair => ({
  key: KEY,
  antigen: {
    tool: SQL,
    code: '42703',
    kind: 'undefined-column',
    target: 'workspace.todo_mirror.statuss',
    fragment: 'statuss',
    reason: ERR_COL,
  },
  failures: 1,
  failedTool: SQL,
  failed: BAD,
  cureTool: SQL,
  cured: GOOD,
  diff: { where: 'content', removed: ['statuss'], added: ['status'] },
  cost: 100,
  firstAt: 1000,
  at: 2000,
  autoimmune: false,
  ...over,
})

// ---------------------------------------------------------------- the taxonomy

test('sqlState reads the SQLSTATE in every form an error comes in', () => {
  expect(sqlState('ERROR: 42703: column "x" does not exist')).toBe('42703')
  expect(sqlState('ERROR:  42P01: relation "x" does not exist\nLINE 1: select')).toBe('42P01')
  expect(sqlState('ERROR: relation "x" does not exist (SQLSTATE 42P01)')).toBe('42P01')
  expect(sqlState('failed with SQLSTATE 42703')).toBe('42703')
  expect(sqlState('SQLSTATE: 22P02')).toBe('22P02')
  expect(sqlState('SQLSTATE=23505')).toBe('23505')
  expect(sqlState('{"code":"42703","message":"column missing"}')).toBe('42703')
  expect(sqlState('{"code": "23505", "details": "dup"}')).toBe('23505')
  expect(sqlState('{\\"code\\":\\"23505\\"}')).toBe('23505')
})

test('sqlState is null when no code is there, and needs a digit and exactly five characters', () => {
  expect(sqlState('')).toBeNull()
  expect(sqlState('no code here')).toBeNull()
  expect(sqlState('ERROR: TIMED OUT after a while')).toBeNull()
  expect(sqlState('{"code":"PGRST"}')).toBeNull()
  expect(sqlState('{"code":"ETIMEDOUT"}')).toBeNull()
  expect(sqlState('SQLSTATE 4270')).toBeNull()
  expect(sqlState('SQLSTATE 427031')).toBeNull()
  expect(sqlState('exit code 42703 from the script')).toBeNull()
})

test('sqlState gives the first code in the text', () => {
  expect(sqlState('ERROR: 42601: syntax error ... then SQLSTATE 42703')).toBe('42601')
  expect(sqlState('ERROR: TIMED then (SQLSTATE 25P02)')).toBe('25P02')
})

test('KIND_BY_CODE names the common codes', () => {
  expect(KIND_BY_CODE['42703']).toBe('undefined-column')
  expect(KIND_BY_CODE['42P01']).toBe('undefined-table')
  expect(KIND_BY_CODE['42601']).toBe('syntax')
  expect(KIND_BY_CODE['23505']).toBe('unique-violation')
  expect(KIND_BY_CODE['25P02']).toBe('aborted-transaction')
  expect(Object.keys(KIND_BY_CODE)).toHaveLength(14)
})

test('errorClass sorts a non-SQL failure, in order', () => {
  expect(errorClass('Permission to use Bash was denied')).toBe('refused')
  expect(errorClass('PreToolUse:Bash hook error: [shell-guard.py]: Refusing a heredoc')).toBe('refused')
  expect(errorClass('the write was blocked by a rule')).toBe('refused')
  expect(errorClass('String to replace not found in file.')).toBe('string-not-found')
  expect(errorClass('old_string was not found in the file')).toBe('string-not-found')
  expect(errorClass('old_string is not unique in the file')).toBe('string-not-found')
  expect(errorClass('Request timed out')).toBe('timeout')
  expect(errorClass('connect ETIMEDOUT 10.0.0.1:443')).toBe('timeout')
  expect(errorClass('ENOENT: no such file or directory')).toBe('not-found')
  expect(errorClass('{"code":"object_not_found"}')).toBe('not-found')
  expect(errorClass('The page does not exist')).toBe('not-found')
  expect(errorClass('{"code":"validation_error","message":"bad body"}')).toBe('validation')
  expect(errorClass('InputValidationError: field could not be parsed')).toBe('validation')
  expect(errorClass('exit code 1')).toBe('other')
  expect(errorClass('')).toBe('other')
})

test('errorClass: a refusal that also says "not found" is refused; the order holds all the way down', () => {
  expect(errorClass('Refusing the write: file not found in the allowlist')).toBe('refused')
  expect(errorClass('String to replace not found in file. Request timed out')).toBe('string-not-found')
  expect(errorClass('timeout while the page was not found')).toBe('timeout')
  expect(errorClass('page not found (validation_error)')).toBe('not-found')
  expect(errorClass('validation_error with status 400')).toBe('validation')
})

test('errorClass reads an HTTP status in its four spellings, case-insensitively', () => {
  expect(errorClass('request failed, status 429')).toBe('http-429')
  expect(errorClass('response status: 500 from upstream')).toBe('http-500')
  expect(errorClass('{"status":502,"detail":"gateway"}')).toBe('http-502')
  expect(errorClass('HTTP 403: Forbidden')).toBe('http-403')
  expect(errorClass('http/1.1 503 Service Unavailable')).toBe('http-503')
  expect(errorClass('status 200 ok')).toBe('other')
  expect(errorClass('PERMISSION TO USE the tool was DENIED')).toBe('refused')
})

// ---------------------------------------------------------------- lines, cost, targets

test('inputLine is one line of at most 300 characters', () => {
  expect(inputLine('  select  1\n from   t  ')).toBe('select 1 from t')
  expect(inputLine({ command: 'git  status\n-sb' })).toBe('git status -sb')
  expect(inputLine({ query: BAD })).toBe(BAD)
  // An Edit's line carries what it replaced (S170), so two Edits of one file are told apart.
  expect(inputLine({ file_path: 'a/b.ts', old_string: 'x' })).toBe('a/b.ts x')
  expect(inputLine({ weird: 1 })).toBe('{"weird":1}')
  expect(inputLine(null)).toBe('')
  expect(inputLine(undefined)).toBe('')
  expect(inputLine('x'.repeat(900))).toHaveLength(PAIR_TEXT_MAX)
  expect(inputLine({ command: 'y'.repeat(900) })).toHaveLength(PAIR_TEXT_MAX)
})

test('estTokens is a quarter of the characters, rounded up', () => {
  expect(estTokens('', '')).toBe(0)
  expect(estTokens('a', '')).toBe(1)
  expect(estTokens('abcd', 'efgh')).toBe(2)
  expect(estTokens('abcde', 'fgh')).toBe(2)
  expect(estTokens('abcde', 'fghi')).toBe(3)
})

test('targetsOf: a SQL call names its tables', () => {
  expect(targetsOf({ tool: SQL, input: { query: BAD } })).toEqual(['workspace.todo_mirror'])
  const join = targetsOf({ tool: SQL, input: { query: 'select a.x from workspace.a_t a join workspace.b_t b on b.id = a.id' } })
  expect(join).toContain('workspace.a_t')
  expect(join).toContain('workspace.b_t')
})

test('targetsOf: files, Notion ids and shell ids come out bare and lower-case', () => {
  expect(targetsOf({ tool: 'Edit', input: { file_path: 'C:\\Work\\A.ts' } })).toEqual(['c:/work/a.ts'])
  expect(targetsOf({ tool: NOTION_UPDATE, input: { page_id: PAGE_DASHED.toUpperCase(), command: 'update_content' } })).toEqual([PAGE])
  const curl = `curl -X PATCH https://api.notion.com/v1/pages/${PAGE_DASHED} -d @body.json`
  expect(targetsOf({ tool: 'Bash', input: { command: curl } })).toEqual([PAGE])
})

test('targetsOf drops the sentinels and keeps nothing it cannot name', () => {
  expect(targetsOf({ tool: 'Bash', input: { command: 'git add -A' } })).toEqual([])
  expect(targetsOf({ tool: 'Bash', input: { command: 'git status' } })).toEqual([])
  expect(targetsOf({ tool: 'mcp__claude_ai_Notion__notion-create-pages', input: { pages: [] } })).toEqual([])
  expect(targetsOf({ tool: NOTION_FETCH, input: {} })).toEqual([])
  expect(targetsOf({ tool: 'mcp__some__thing', input: { a: 1 } })).toEqual([])
  expect(targetsOf({ tool: 'Edit', input: 'not an object' })).toEqual([])
  expect(targetsOf({ tool: 'Edit', input: null })).toEqual([])
})

test('targetsOf strips a kind prefix', () => {
  expect(targetsOf({ tool: 'Bash', input: { command: 'git push origin main' } })).toEqual(['push'])
  const mig = targetsOf({ tool: 'mcp__claude_ai_Supabase__apply_migration', input: { name: 'Add_X', query: 'create table t(a int)' } })
  expect(mig).toContain('add_x')
  expect(mig.some((t) => t.includes('migration:'))).toBe(false)
})

test('targetsOf dedupes', () => {
  const t = targetsOf({ tool: NOTION_UPDATE, input: { page_id: PAGE, id: PAGE_DASHED, command: PAGE } })
  expect(t.filter((x) => x === PAGE)).toHaveLength(1)
})

// ---------------------------------------------------------------- the antigen

test('antigenOf: an undefined column names table and column', () => {
  const a = antigenOf({ tool: SQL, input: { query: BAD }, resultText: ERR_COL })
  expect(a.tool).toBe(SQL)
  expect(a.code).toBe('42703')
  expect(a.kind).toBe('undefined-column')
  expect(a.target).toBe('workspace.todo_mirror.statuss')
  expect(a.fragment).toBe('statuss')
  expect(a.reason).toBe(ERR_COL)
  expect(epitope(a)).toBe(KEY)
})

test('antigenOf: a column written t.x takes the part after the last dot; no table leaves the bare column', () => {
  const a = antigenOf({
    tool: SQL,
    input: { query: 'select t.statuss from workspace.todo_mirror t' },
    resultText: 'ERROR:  42703: column t.statuss does not exist\nLINE 1: select t.statuss',
  })
  expect(a.target).toBe('workspace.todo_mirror.statuss')
  expect(a.fragment).toBe('statuss')
  const bare = antigenOf({ tool: SQL, input: { query: 'select 1' }, resultText: 'ERROR: 42703: column "zed" does not exist' })
  expect(bare.target).toBe('zed')
  expect(bare.fragment).toBe('zed')
})

test('antigenOf: with two tables named, the first is the table', () => {
  const a = antigenOf({
    tool: SQL,
    input: { query: 'select nope from workspace.first_t a join workspace.second_t b on true' },
    resultText: 'ERROR: 42703: column "nope" does not exist',
  })
  expect(a.target).toBe('workspace.first_t.nope')
})

test('antigenOf: an undefined table is its own target and fragment, lower-cased', () => {
  const a = antigenOf({
    tool: SQL,
    input: { query: 'select * from workspace.Todo_Mirorr' },
    resultText: 'ERROR:  42P01: relation "workspace.Todo_Mirorr" does not exist\nLINE 1: select',
  })
  expect(a.code).toBe('42P01')
  expect(a.kind).toBe('undefined-table')
  expect(a.target).toBe('workspace.todo_mirorr')
  expect(a.fragment).toBe('workspace.todo_mirorr')
})

test('antigenOf: any other SQL code targets the first table with no fragment', () => {
  const a = antigenOf({
    tool: SQL,
    input: { query: "insert into workspace.todo_mirror (id) values ('x')" },
    resultText: 'ERROR: 23505: duplicate key value violates unique constraint "todo_mirror_pkey"',
  })
  expect(a.code).toBe('23505')
  expect(a.kind).toBe('unique-violation')
  expect(a.target).toBe('workspace.todo_mirror')
  expect(a.fragment).toBe('')
  const unknown = antigenOf({ tool: SQL, input: { query: 'select 1 from workspace.t_t' }, resultText: 'ERROR: 40001: could not serialize' })
  expect(unknown.kind).toBe('40001')
})

test('antigenOf: a SQLSTATE in the text counts even when the tool is not a SQL tool', () => {
  const a = antigenOf({ tool: 'Bash', input: { command: 'psql -c x' }, resultText: 'psql: ERROR: 42601: syntax error' })
  expect(a.code).toBe('42601')
})

test('antigenOf: an Edit whose string was not found targets the file', () => {
  const a = antigenOf({
    tool: 'Edit',
    input: { file_path: 'C:\\Work\\A.ts', old_string: 'x', new_string: 'y' },
    resultText: '<tool_use_error>String to replace not found in file.\nString: x</tool_use_error>',
  })
  expect(a.code).toBe('string-not-found')
  expect(a.kind).toBe('string-not-found')
  expect(a.target).toBe('c:/work/a.ts')
  expect(a.fragment).toBe('c:/work/a.ts')
  expect(a.reason).toBe('<tool_use_error>String to replace not found in file.')
})

test('antigenOf: a notebook edit targets its notebook path; a file call with no path falls back to the tool', () => {
  const nb = antigenOf({ tool: 'NotebookEdit', input: { notebook_path: 'N/Book.ipynb' }, resultText: 'cell not found' })
  expect(nb.target).toBe('n/book.ipynb')
  const none = antigenOf({ tool: 'Read', input: {}, resultText: 'File does not exist' })
  expect(none.target).toBe('Read')
  expect(none.fragment).toBe('')
})

test('antigenOf: a Notion tool targets the first id in its input, else the tool', () => {
  const a = antigenOf({ tool: NOTION_UPDATE, input: { page_id: PAGE_DASHED, command: 'update_content' }, resultText: 'HTTP 403: Forbidden' })
  expect(a.code).toBe('http-403')
  expect(a.kind).toBe('http-403')
  expect(a.target).toBe(PAGE)
  expect(a.fragment).toBe(PAGE)
  const no = antigenOf({ tool: 'mcp__claude_ai_Notion__notion-search', input: { query: 'word' }, resultText: 'status 429' })
  expect(no.target).toBe('mcp__claude_ai_Notion__notion-search')
  expect(no.fragment).toBe('')
})

test('antigenOf: any other tool takes its first target, else its own name', () => {
  const sh = antigenOf({ tool: 'Bash', input: { command: 'cat src/gone.ts' }, resultText: 'cat: src/gone.ts: No such file or directory' })
  expect(sh.code).toBe('not-found')
  expect(sh.target).toBe('src/gone.ts')
  const bare = antigenOf({ tool: 'Bash', input: { command: 'false' }, resultText: 'exit 1' })
  expect(bare.code).toBe('other')
  expect(bare.target).toBe('Bash')
  expect(bare.fragment).toBe('')
})

test('antigenOf: reason is the first non-empty line, one line, at most 160; fragment at most 120', () => {
  const a = antigenOf({ tool: 'Bash', input: { command: 'x' }, resultText: '\n  \n   ERROR:   boom    here  \nsecond line' })
  expect(a.reason).toBe('ERROR: boom here')
  const long = antigenOf({ tool: 'Bash', input: { command: 'x' }, resultText: 'e'.repeat(500) })
  expect(long.reason).toHaveLength(160)
  const path = 'd/'.repeat(100) + 'file.ts'
  const f = antigenOf({ tool: 'Write', input: { file_path: path }, resultText: 'denied' })
  expect(f.fragment).toHaveLength(120)
  expect(antigenOf({ tool: 'Bash', input: {}, resultText: '' }).reason).toBe('')
})

// ---------------------------------------------------------------- open failures

test('noteFailure opens a failure with its epitope key, targets and cost', () => {
  const opens = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1000 })
  expect(opens).toHaveLength(1)
  const o = opens[0]!
  expect(o.key).toBe(KEY)
  expect(o.antigen.code).toBe('42703')
  expect(o.targets).toContain('workspace.todo_mirror')
  expect(o.targets).toContain('workspace.todo_mirror.statuss')
  expect(o.attempts).toBe(1)
  expect(o.cost).toBe(estTokens(BAD, ERR_COL))
  expect(o.lastTool).toBe(SQL)
  expect(o.lastInput).toBe(BAD)
  expect(o.firstAt).toBe(1000)
  expect(o.lastAt).toBe(1000)
  expect(o.since).toBe(0)
})

test('noteFailure merges a second attempt on one key and keeps two keys apart', () => {
  const first = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1000 })
  const aged = age(first, 1500)
  expect(aged[0]!.since).toBe(1)
  const again = "UPDATE workspace.todo_mirror SET statuss = 'Open' WHERE id = 'y'"
  const merged = noteFailure(aged, { tool: SQL, input: { query: again }, resultText: ERR_COL, at: 2000 })
  expect(merged).toHaveLength(1)
  const o = merged[0]!
  expect(o.attempts).toBe(2)
  expect(o.cost).toBe(estTokens(BAD, ERR_COL) + estTokens(again, ERR_COL))
  expect(o.lastInput).toBe(again)
  expect(o.lastAt).toBe(2000)
  expect(o.firstAt).toBe(1000)
  expect(o.since).toBe(0)
  const other = noteFailure(merged, {
    tool: 'Edit',
    input: { file_path: 'a/b.ts' },
    resultText: 'String to replace not found in file.',
    at: 3000,
  })
  expect(other.map((x) => x.key)).toEqual([KEY, 'string-not-found|a/b.ts'])
})

test('noteFailure unions the targets of a second attempt', () => {
  const first = noteFailure([], { tool: 'Bash', input: { command: 'cat a/one.ts' }, resultText: 'No such file', at: 1 })
  const second = noteFailure(first, { tool: 'Bash', input: { command: 'cat a/one.ts a/two.ts' }, resultText: 'No such file', at: 2 })
  expect(second).toHaveLength(1)
  expect(second[0]!.targets).toContain('a/one.ts')
  expect(second[0]!.targets).toContain('a/two.ts')
  expect(second[0]!.attempts).toBe(2)
})

test('noteFailure on an MCP call that names nothing keys on the tool name', () => {
  const tool = 'mcp__notebooklm__ask_question'
  const opens = noteFailure([], { tool, input: { question: 'q' }, resultText: 'boom', at: 5 })
  expect(opens[0]!.key).toBe(`other|${tool}`)
  expect(opens[0]!.targets).toEqual([tool])
})

// The blind verifier (S170): a grep that found nothing, then an `ls`, became a pair, and two
// such became "Check Bash before sending". A shell failure naming nothing is exploration.
test('a shell failure with no known error on nothing it names opens no antigen', () => {
  for (const tool of ['Bash', 'PowerShell', 'Monitor']) {
    expect(noteFailure([], { tool, input: { command: 'false' }, resultText: 'exit 1', at: 5 })).toEqual([])
  }
  // A shell failure that IS classified (a refusal) still opens one.
  expect(noteFailure([], { tool: 'Bash', input: { command: 'false' }, resultText: 'hook error: refusing', at: 5 })).toHaveLength(1)
})

test('a path is matched whole: a failure on a.ts is not cured by a write to a.tsx (S170)', () => {
  const o = noteFailure([], { tool: 'Edit', input: { file_path: 'c:/w/src/a.ts', old_string: 'q' }, resultText: 'String to replace not found', at: 1 })
  expect(cure(o, { tool: 'Bash', input: { command: 'cp x c:/w/src/a.tsx' }, at: 2 }).pairs).toEqual([])
  expect(cure(o, { tool: 'Bash', input: { command: 'cp x c:/w/src/a.ts' }, at: 3 }).pairs).toHaveLength(1)
})

// Seen live (S170): the MCP error came JSON-escaped and the column was never read.
test('an escaped 42703 still names table and column', () => {
  const a = antigenOf({ tool: SQL, input: { query: BAD }, resultText: 'ERROR: 42703: column \\"statuss\\" of relation \\"todo_mirror\\" does not exist' })
  expect(a.target).toBe('workspace.todo_mirror.statuss')
  expect(a.fragment).toBe('statuss')
})

test('a stored shell-exploration pair from the first build is dropped on load; a real one is kept', () => {
  const noise = pair({ key: 'other|Bash', antigen: { tool: 'Bash', code: 'other', kind: 'other', target: 'Bash', fragment: '', reason: 'x' } })
  const refused = pair({ key: 'refused|Bash', antigen: { tool: 'Bash', code: 'refused', kind: 'refused', target: 'Bash', fragment: '', reason: 'x' } })
  expect(asPairs([noise, refused, pair()]).map(p => p.key)).toEqual(['refused|Bash', KEY])
})

test('the diff reads the whole line: a fix past the 300 kept for display is content, not weather (S170)', () => {
  const pad = `SELECT ${'x, '.repeat(120)}`
  const bad = `${pad} statuss FROM workspace.todo_mirror`
  const good = `${pad} status FROM workspace.todo_mirror`
  const o = noteFailure([], { tool: SQL, input: { query: bad }, resultText: ERR_COL, at: 1 })
  const p = cure(o, { tool: SQL, input: { query: good }, at: 2 }).pairs[0]!
  expect(p.failed.length).toBe(PAIR_TEXT_MAX)
  expect(p.diff.where).toBe('content')
  expect(p.diff.removed).toContain('statuss')
})

// ---------------------------------------------------------------- the cure

test('THE CORE CASE: a misspelled column, then the same call with the right one, is one content pair', () => {
  const opens = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1000 })
  const out = cure(opens, { tool: SQL, input: { query: GOOD }, at: 5000 })
  expect(out.opens).toEqual([])
  expect(out.pairs).toHaveLength(1)
  const p = out.pairs[0]!
  expect(p.key).toBe(KEY)
  expect(p.antigen.code).toBe('42703')
  expect(p.diff.where).toBe('content')
  expect(p.diff.removed).toContain('statuss')
  expect(p.diff.added).toContain('status')
  expect(p.diff).toEqual({ where: 'content', removed: ['statuss'], added: ['status'] })
  expect(p.failures).toBe(1)
  expect(p.cost).toBeGreaterThan(0)
  expect(p.failedTool).toBe(SQL)
  expect(p.failed).toBe(BAD)
  expect(p.cureTool).toBe(SQL)
  expect(p.cured).toBe(GOOD)
  expect(p.firstAt).toBe(1000)
  expect(p.at).toBe(5000)
  expect(p.autoimmune).toBe(false)
})

test('cure counts every failed attempt before the cure', () => {
  let opens = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1000 })
  opens = noteFailure(opens, { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 2000 })
  const out = cure(opens, { tool: SQL, input: { query: GOOD }, at: 3000 })
  expect(out.pairs[0]!.failures).toBe(2)
  expect(out.pairs[0]!.cost).toBe(2 * estTokens(BAD, ERR_COL))
})

test('a ROUTE pair: a refused Notion call, then a REST call on the same page from the shell', () => {
  const opens = noteFailure([], {
    tool: NOTION_UPDATE,
    input: { page_id: PAGE, command: 'update_content' },
    resultText: 'HTTP 403: Forbidden',
    at: 1000,
  })
  expect(opens[0]!.key).toBe(`http-403|${PAGE}`)
  const curl = `curl -X PATCH https://api.notion.com/v1/pages/${PAGE_DASHED} -d @body.json`
  const out = cure(opens, { tool: 'Bash', input: { command: curl }, at: 4000 })
  expect(out.opens).toEqual([])
  expect(out.pairs).toHaveLength(1)
  const p = out.pairs[0]!
  expect(p.diff.where).toBe('route')
  expect(p.failedTool).toBe(NOTION_UPDATE)
  expect(p.cureTool).toBe('Bash')
  expect(p.cured).toBe(curl)
  expect(p.autoimmune).toBe(false)
})

test('a WEATHER pair: the identical call fails on a timeout and later succeeds', () => {
  const input = { id: PAGE }
  const opens = noteFailure([], { tool: NOTION_FETCH, input, resultText: 'Request timed out', at: 1000 })
  const out = cure(opens, { tool: NOTION_FETCH, input, at: 9000 })
  expect(out.pairs).toHaveLength(1)
  expect(out.pairs[0]!.antigen.code).toBe('timeout')
  expect(out.pairs[0]!.diff).toEqual({ where: 'none', removed: [], added: [] })
  expect(out.pairs[0]!.autoimmune).toBe(false)
})

test('an AUTOIMMUNE pair: a guard refused a Bash call that then went through unchanged', () => {
  const command = 'git add -A'
  const refusal = 'PreToolUse:Bash hook error: [python shell-guard.py]: Refusing git add -A.'
  const opens = noteFailure([], { tool: 'Bash', input: { command }, resultText: refusal, at: 1000 })
  expect(opens[0]!.antigen.code).toBe('refused')
  const out = cure(opens, { tool: 'Bash', input: { command }, at: 2000 })
  expect(out.pairs).toHaveLength(1)
  expect(out.pairs[0]!.diff.where).toBe('none')
  expect(out.pairs[0]!.autoimmune).toBe(true)
})

test('a refusal cured by a changed call is a content pair, not autoimmune', () => {
  const refusal = 'PreToolUse:Bash hook error: Refusing a redirect'
  const opens = noteFailure([], { tool: 'Bash', input: { command: 'echo hi > notes/out.txt' }, resultText: refusal, at: 1 })
  const out = cure(opens, { tool: 'Bash', input: { command: 'echo hi | tee notes/out.txt' }, at: 2 })
  expect(out.pairs).toHaveLength(1)
  expect(out.pairs[0]!.diff.where).toBe('content')
  expect(out.pairs[0]!.autoimmune).toBe(false)
})

test('a success on an unrelated target cures nothing and changes nothing', () => {
  const opens = noteFailure([], { tool: 'Edit', input: { file_path: 'src/a.ts' }, resultText: 'String to replace not found', at: 1 })
  const out = cure(opens, { tool: 'Read', input: { file_path: 'src/b.ts' }, at: 2 })
  expect(out.pairs).toEqual([])
  expect(out.opens).toEqual(opens)
  const sh = cure(opens, { tool: 'Bash', input: { command: 'ls' }, at: 3 })
  expect(sh.pairs).toEqual([])
  expect(sh.opens).toHaveLength(1)
})

test('cure only closes the opens it hits', () => {
  let opens = noteFailure([], { tool: 'Edit', input: { file_path: 'src/a.ts' }, resultText: 'String to replace not found', at: 1 })
  opens = noteFailure(opens, { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 2 })
  const out = cure(opens, { tool: SQL, input: { query: GOOD }, at: 3 })
  expect(out.pairs.map((p) => p.key)).toEqual([KEY])
  expect(out.opens.map((o) => o.key)).toEqual(['string-not-found|src/a.ts'])
})

// Director's fix at merge (S170): the input line carries an Edit's old_string, so a corrected
// Edit of the same file is a content pair, not weather.
test('a failed file edit is cured by a corrected edit as content, by a Write as another route', () => {
  const opens = noteFailure([], { tool: 'Edit', input: { file_path: 'src/a.ts', old_string: 'xold' }, resultText: 'String to replace not found', at: 1 })
  const same = cure(opens, { tool: 'Edit', input: { file_path: 'src/a.ts', old_string: 'ynew' }, at: 2 })
  expect(same.pairs[0]!.diff.where).toBe('content')
  expect(same.pairs[0]!.diff.removed).toContain('xold')
  expect(same.pairs[0]!.diff.added).toContain('ynew')
  const route = cure(opens, { tool: 'Write', input: { file_path: 'src/a.ts' }, at: 2 })
  expect(route.pairs[0]!.diff.where).toBe('route')
})

// Director's fix at merge (S170): reading the file or the table after a failed write is the
// investigation, not the cure; and a query that only mentions a table in its text is not on it.
test('a failed write is cured only by a write: a Read or a SELECT of the target is not the cure', () => {
  const edit = noteFailure([], { tool: 'Edit', input: { file_path: 'src/a.ts', old_string: 'q' }, resultText: 'String to replace not found', at: 1 })
  expect(edit[0]!.write).toBe(true)
  expect(cure(edit, { tool: 'Read', input: { file_path: 'src/a.ts' }, at: 2 }).pairs).toEqual([])
  const sql = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1 })
  expect(cure(sql, { tool: SQL, input: { query: 'SELECT status FROM workspace.todo_mirror LIMIT 1' }, at: 2 }).pairs).toEqual([])
  const probe = "SELECT column_name FROM information_schema.columns WHERE table_schema='workspace' AND table_name='todo_mirror'"
  expect(cure(sql, { tool: SQL, input: { query: probe }, at: 3 }).pairs).toEqual([])
  expect(cure(sql, { tool: SQL, input: { query: GOOD }, at: 4 }).pairs).toHaveLength(1)
})

test('a failed read is cured by a read, and a bare table name in the text alone is not a hit', () => {
  const read = noteFailure([], { tool: SQL, input: { query: 'SELECT statuss FROM workspace.todo_mirror' }, resultText: ERR_COL, at: 1 })
  expect(read[0]!.write).toBe(false)
  const mention = cure(read, { tool: SQL, input: { query: "SELECT 1 FROM information_schema.tables WHERE table_name='workspace.todo_mirror'" }, at: 2 })
  expect(mention.pairs).toEqual([])
  expect(cure(read, { tool: SQL, input: { query: 'SELECT status FROM workspace.todo_mirror' }, at: 3 }).pairs).toHaveLength(1)
})

// A side agent's note (S170): every retry re-reads the whole context, which the character
// estimate leaves out; the measured context per attempt rides beside it, for ranking.
test('the context each failed attempt re-read is summed, carried into the pair and said beside the estimate', () => {
  let opens = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1, context: 50_000 })
  opens = noteFailure(opens, { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 2, context: 52_000 })
  expect(opens[0]!.reread).toBe(102_000)
  const p = cure(opens, { tool: SQL, input: { query: GOOD }, at: 3 }).pairs[0]!
  expect(p.reread).toBe(102_000)
  expect(pairLine(p)).toContain('+ ~102k context re-read')
  expect(asPairs([p])[0]!.reread).toBe(102_000)
  // Not measured: no figure, and none invented.
  const bare = noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1, context: Number.NaN })
  expect(bare[0]!.reread).toBeUndefined()
  expect(pairLine(cure(bare, { tool: SQL, input: { query: GOOD }, at: 2 }).pairs[0]!)).not.toContain('re-read')
})

test('memory ranks by the estimate plus the context re-read', () => {
  const cheapCalls = (at: number) => pair({ key: 'a', at, cost: 50, reread: 40_000 })
  const dearCalls = (at: number) => pair({ key: 'b', at, cost: 900 })
  expect(memory([dearCalls(1), dearCalls(2), cheapCalls(3), cheapCalls(4)]).map((g) => g.key)).toEqual(['a', 'b'])
  expect(memory([cheapCalls(3), cheapCalls(4)])[0]!.reread).toBe(80_000)
})

test('targetsOf reads the tables of a migration as of a query', () => {
  const t = targetsOf({ tool: 'mcp__claude_ai_Supabase__apply_migration', input: { name: 'm', query: "INSERT INTO workspace.todo_mirror (id) VALUES ('a')" } })
  expect(t).toContain('workspace.todo_mirror')
})

// ---------------------------------------------------------------- the window

test('age adds one call and drops an open past the window of calls', () => {
  const aged = age([open({ since: 3 })], 10)
  expect(aged[0]!.since).toBe(4)
  expect(age([open({ since: REPAIR_WINDOW_CALLS - 1 })], 10)).toHaveLength(1)
  expect(age([open({ since: REPAIR_WINDOW_CALLS })], 10)).toEqual([])
})

test('age drops an open past the time window, keeps one exactly at it', () => {
  expect(age([open({ lastAt: 0 })], REPAIR_WINDOW_MS)).toHaveLength(1)
  expect(age([open({ lastAt: 0 })], REPAIR_WINDOW_MS + 1)).toEqual([])
  const mixed = age([open({ key: 'old', lastAt: 0 }), open({ key: 'new', lastAt: REPAIR_WINDOW_MS })], REPAIR_WINDOW_MS + 5)
  expect(mixed.map((o) => o.key)).toEqual(['new'])
})

// ---------------------------------------------------------------- hits

test('hits: a shared target, a target named in the line, or nothing', () => {
  const o = open({ antigen: { tool: 'Edit', code: 'x', kind: 'x', target: 'src/a.ts', fragment: '', reason: '' }, targets: ['src/a.ts'], lastTool: 'Edit' })
  expect(hits(o, { tool: 'Read', line: 'src/a.ts', targets: ['src/a.ts'] })).toBe(true)
  expect(hits(o, { tool: 'Bash', line: 'cat SRC/A.TS | head', targets: [] })).toBe(true)
  expect(hits(o, { tool: 'Bash', line: 'cat src/b.ts', targets: ['src/b.ts'] })).toBe(false)
})

test('hits: a Notion id matches dashless, a path matches with backslashes', () => {
  const id = open({ targets: [PAGE], lastTool: NOTION_UPDATE, antigen: { ...open().antigen, tool: NOTION_UPDATE, target: PAGE } })
  expect(hits(id, { tool: 'Bash', line: `curl https://api.notion.com/v1/pages/${PAGE_DASHED}`, targets: [] })).toBe(true)
  expect(hits(id, { tool: 'Bash', line: 'curl https://api.notion.com/v1/pages/3f43d581-ffff', targets: [] })).toBe(false)
  const file = open({ targets: ['c:/work/a.ts'], antigen: { ...open().antigen, tool: 'Edit', target: 'c:/work/a.ts' }, lastTool: 'Edit' })
  expect(hits(file, { tool: 'Bash', line: 'type C:\\Work\\A.ts', targets: [] })).toBe(true)
})

test('hits: a target shorter than six characters is matched in the set only, never in the text', () => {
  const o = open({ targets: ['a.ts'], antigen: { ...open().antigen, tool: 'Edit', target: 'a.ts' }, lastTool: 'Edit' })
  expect(hits(o, { tool: 'Bash', line: 'cat a.ts', targets: [] })).toBe(false)
  expect(hits(o, { tool: 'Bash', line: 'cat a.ts', targets: ['a.ts'] })).toBe(true)
})

test('hits: when nothing specific was named, only the same tool cures', () => {
  const o = open()
  expect(hits(o, { tool: 'Bash', line: 'ls', targets: [] })).toBe(true)
  expect(hits(o, { tool: 'Edit', line: 'ls Bash', targets: [] })).toBe(false)
  expect(hits(open({ targets: [] }), { tool: 'Bash', line: 'x', targets: [] })).toBe(true)
})

// ---------------------------------------------------------------- the diff

test('diffOf: same tool, same line after case and whitespace, is none', () => {
  expect(diffOf('Bash', 'git  Status', 'Bash', 'GIT status\n')).toEqual({ where: 'none', removed: [], added: [] })
})

test('diffOf: a different tool is route, with the tokens still computed', () => {
  expect(diffOf('A', 'foo bar', 'B', 'foo baz')).toEqual({ where: 'route', removed: ['bar'], added: ['baz'] })
})

test('diffOf: the same tool and a changed line is content, tokens in order of first appearance, deduped', () => {
  expect(diffOf('T', 'aa aa bb keep', 'T', 'keep cc')).toEqual({ where: 'content', removed: ['aa', 'bb'], added: ['cc'] })
  expect(diffOf('T', BAD, 'T', GOOD)).toEqual({ where: 'content', removed: ['statuss'], added: ['status'] })
})

test('diffOf: quoted strings are tokens, and what is inside them is not read again', () => {
  expect(diffOf('T', "x = 'foo bar'", 'T', 'x = "baz"')).toEqual({ where: 'content', removed: ["'foo bar'"], added: ['"baz"'] })
})

test('diffOf: at most six tokens a side, each at most 40 characters', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `ident${i}`).join(' ')
  const d = diffOf('T', ids, 'T', 'zz')
  expect(d.removed).toHaveLength(MAX_DIFF_TOKENS)
  expect(d.removed[0]).toBe('ident0')
  expect(d.removed[5]).toBe('ident5')
  const long = diffOf('T', 'q'.repeat(60), 'T', 'r')
  expect(long.removed[0]).toHaveLength(40)
})

// ---------------------------------------------------------------- the store

test('addPairs appends and keeps the newest 100', () => {
  let stored: RepairPair[] = []
  for (let i = 0; i < REPAIRS_KEPT + 5; i++) stored = addPairs(stored, [pair({ at: i })])
  expect(stored).toHaveLength(REPAIRS_KEPT)
  expect(stored[0]!.at).toBe(5)
  expect(stored[stored.length - 1]!.at).toBe(REPAIRS_KEPT + 4)
  expect(addPairs([], [pair()])).toHaveLength(1)
  expect(addPairs(stored, [])).toEqual(stored)
})

test('asPairs keeps a well-formed pair and drops the junk', () => {
  const good = pair()
  const kept = asPairs([good, null, 5, 'x', [], {}, { ...good, diff: { ...good.diff, where: 'maybe' } }])
  expect(kept).toEqual([good])
  expect(kept[0] === good).toBe(false)
  expect(asPairs('nope')).toEqual([])
  expect(asPairs(null)).toEqual([])
  expect(asPairs({ length: 1 })).toEqual([])
})

test('asPairs checks every declared field', () => {
  const good = pair()
  const bad: unknown[] = [
    { ...good, key: 7 },
    { ...good, failures: '1' },
    { ...good, cost: null },
    { ...good, at: undefined },
    { ...good, firstAt: 'x' },
    { ...good, autoimmune: 'no' },
    { ...good, failed: 3 },
    { ...good, cureTool: null },
    { ...good, antigen: null },
    { ...good, antigen: { ...good.antigen, reason: 4 } },
    { ...good, antigen: { ...good.antigen, tool: undefined } },
    { ...good, diff: { where: 'content', removed: [1], added: [] } },
    { ...good, diff: { where: 'content', removed: [], added: 'status' } },
    { ...good, diff: null },
  ]
  expect(asPairs(bad)).toEqual([])
  const weather = pair({ diff: { where: 'none', removed: [], added: [] } })
  const route = pair({ diff: { where: 'route', removed: ['a'], added: ['b'] } })
  expect(asPairs([weather, route])).toEqual([weather, route])
})

// ---------------------------------------------------------------- memory

test('memory keeps a key seen twice, sums its cost, and names the newest pair', () => {
  const m = memory([pair({ at: 100, cost: 30 }), pair({ at: 300, cost: 50, failures: 2 })])
  expect(m).toHaveLength(1)
  expect(m[0]!.key).toBe(KEY)
  expect(m[0]!.count).toBe(2)
  expect(m[0]!.cost).toBe(80)
  expect(m[0]!.last.at).toBe(300)
  expect(m[0]!.last.failures).toBe(2)
})

test('memory drops a single pair, and weather left alone', () => {
  const none = { where: 'none' as const, removed: [], added: [] }
  const weather = (at: number) => pair({ key: 'timeout|x', at, diff: none })
  expect(memory([pair()])).toEqual([])
  expect(memory([weather(1), weather(2)])).toEqual([])
  // A key whose newest pair is weather is weather, whatever it was before.
  expect(memory([pair({ at: 1 }), pair({ at: 2, diff: none })])).toEqual([])
  // A key that was weather and is now a real fix is kept.
  expect(memory([pair({ at: 1, diff: none }), pair({ at: 2 })])).toHaveLength(1)
})

test('memory keeps weather that has an autoimmune pair in it', () => {
  const none = { where: 'none' as const, removed: [], added: [] }
  const m = memory([
    pair({ key: 'refused|Bash', at: 1, diff: none, autoimmune: true }),
    pair({ key: 'refused|Bash', at: 2, diff: none, autoimmune: false }),
  ])
  expect(m).toHaveLength(1)
  expect(m[0]!.count).toBe(2)
})

test('memory sorts by cost, dearest first', () => {
  const m = memory([
    pair({ key: 'a', cost: 10, at: 1 }),
    pair({ key: 'a', cost: 10, at: 2 }),
    pair({ key: 'b', cost: 90, at: 3 }),
    pair({ key: 'b', cost: 90, at: 4 }),
  ])
  expect(m.map((g) => g.key)).toEqual(['b', 'a'])
})

test('shortTool takes the part after the last double underscore', () => {
  expect(shortTool('mcp__claude_ai_Supabase__execute_sql')).toBe('execute_sql')
  expect(shortTool('mcp__claude_ai_Notion__notion-update-page')).toBe('notion-update-page')
  expect(shortTool('Bash')).toBe('Bash')
})

// ---------------------------------------------------------------- candidates

test('pairCandidates: a recurring content pair is a hook candidate', () => {
  const out = pairCandidates([pair({ at: 1, cost: 40 }), pair({ at: 2, cost: 60 })], [], 777)
  expect(out).toHaveLength(1)
  const c = out[0]!
  expect(c.key).toBe(`pair:${KEY}`)
  expect(c.kind).toBe('hook')
  expect(c.title).toBe('Check workspace.todo_mirror.statuss before sending (42703 undefined-column)')
  expect(c.why).toBe('2 repair pairs, ~100 est. tokens lost to the failed attempts')
  expect(c.evidence).toBe(pairLine(pair({ at: 2, cost: 60 })))
  expect(c.filed).toBe(false)
  expect(c.at).toBe(777)
})

test('pairCandidates: a recurring route pair is a skill candidate', () => {
  const route = (at: number) =>
    pair({
      key: `http-403|${PAGE}`,
      antigen: { tool: NOTION_UPDATE, code: 'http-403', kind: 'http-403', target: PAGE, fragment: PAGE, reason: 'HTTP 403' },
      failedTool: NOTION_UPDATE,
      cureTool: 'Bash',
      diff: { where: 'route', removed: ['a'], added: ['b'] },
      at,
    })
  const out = pairCandidates([route(1), route(2)], [], 5)
  expect(out[0]!.kind).toBe('skill')
  expect(out[0]!.title).toBe(`Reach ${PAGE} by Bash, not notion-update-page`)
})

test('pairCandidates: an autoimmune group asks for a retune of the guard', () => {
  const none = { where: 'none' as const, removed: [], added: [] }
  const auto = (at: number, autoimmune: boolean) =>
    pair({
      key: 'refused|Bash',
      antigen: { tool: 'Bash', code: 'refused', kind: 'refused', target: 'Bash', fragment: '', reason: 'Refusing' },
      failedTool: 'Bash',
      cureTool: 'Bash',
      diff: none,
      autoimmune,
      at,
    })
  const out = pairCandidates([auto(1, true), auto(2, false)], [], 5)
  expect(out).toHaveLength(1)
  expect(out[0]!.kind).toBe('hook')
  expect(out[0]!.title).toBe('Retune the guard that refused Bash on Bash')
})

test('pairCandidates: nothing for a key already filed, a lone pair, or weather', () => {
  const pairs = [pair({ at: 1 }), pair({ at: 2 })]
  const existing: Candidate[] = [{ key: `pair:${KEY}`, kind: 'hook', title: 't', why: 'w', evidence: 'e', at: 1, filed: true }]
  expect(pairCandidates(pairs, existing, 9)).toEqual([])
  expect(pairCandidates([pair()], [], 9)).toEqual([])
  const none = { where: 'none' as const, removed: [], added: [] }
  expect(pairCandidates([pair({ at: 1, diff: none }), pair({ at: 2, diff: none })], [], 9)).toEqual([])
})

test('pairCandidates: titles stop at 80 characters, why at 160, evidence at 200', () => {
  const target = `workspace.${'t'.repeat(120)}.column`
  const long = (at: number) =>
    pair({
      key: `42703|${target}`,
      antigen: { tool: SQL, code: '42703', kind: 'undefined-column', target, fragment: 'column', reason: 'r' },
      diff: { where: 'content', removed: ['q'.repeat(40), 'r'.repeat(40), 's'.repeat(40), 'u'.repeat(40)], added: ['v'.repeat(40), 'w'.repeat(40)] },
      at,
    })
  const c = pairCandidates([long(1), long(2)], [], 1)[0]!
  expect(c.title).toHaveLength(80)
  expect(c.title.endsWith('...')).toBe(true)
  expect(c.why.length <= 160).toBe(true)
  expect(c.evidence.length <= 200).toBe(true)
})

// ---------------------------------------------------------------- lines and section

test('pairLine, content: removed and added, or just the side that has tokens', () => {
  expect(pairLine(pair())).toBe(
    '42703 undefined-column on workspace.todo_mirror.statuss: 1 failed (~100 est. tokens), cured by execute_sql - removed statuss; added status',
  )
  expect(pairLine(pair({ diff: { where: 'content', removed: ['a', 'b'], added: [] } }))).toBe(
    '42703 undefined-column on workspace.todo_mirror.statuss: 1 failed (~100 est. tokens), cured by execute_sql - removed a, b',
  )
  expect(pairLine(pair({ diff: { where: 'content', removed: [], added: ['c'] } }))).toBe(
    '42703 undefined-column on workspace.todo_mirror.statuss: 1 failed (~100 est. tokens), cured by execute_sql - added c',
  )
  expect(pairLine(pair({ diff: { where: 'content', removed: [], added: [] } }))).toBe(
    '42703 undefined-column on workspace.todo_mirror.statuss: 1 failed (~100 est. tokens), cured by execute_sql',
  )
})

test('pairLine: route, weather and autoimmune', () => {
  const route = pairLine(pair({ cureTool: 'Bash', diff: { where: 'route', removed: [], added: [] } }))
  expect(route.endsWith('cured by Bash - by another route')).toBe(true)
  const none = { where: 'none' as const, removed: [], added: [] }
  expect(pairLine(pair({ failures: 3, diff: none })).endsWith('3 failed (~100 est. tokens), cured by execute_sql - unchanged (weather)')).toBe(true)
  const auto = pairLine(pair({ diff: none, autoimmune: true }))
  expect(auto.endsWith(' - AUTOIMMUNE: a guard refused a call that then went through unchanged')).toBe(true)
  expect(auto.includes('weather')).toBe(false)
})

test('pairsSection lists the pairs cured since a time, or says none', () => {
  const lines = pairsSection([pair({ at: 100 }), pair({ at: 500, key: 'k2' })], 300)
  expect(lines.slice(0, 2)).toEqual(['### Repair pairs', ''])
  expect(lines).toHaveLength(3)
  expect(lines[2]).toBe(`- ${pairLine(pair({ at: 500, key: 'k2' }))}`)
  expect(pairsSection([pair({ at: 100 })], 300)).toEqual(['### Repair pairs', '', '- None this watch.'])
  expect(pairsSection([], 0)).toEqual(['### Repair pairs', '', '- None this watch.'])
  expect(pairsSection([pair({ at: 300 })], 300)).toHaveLength(3)
})

// ---------------------------------------------------------------- purity

test('no function mutates what it is given', () => {
  const opens = deepFreeze(noteFailure([], { tool: SQL, input: { query: BAD }, resultText: ERR_COL, at: 1000 }))
  const callIn = deepFreeze({ query: GOOD })
  const failIn = deepFreeze({ query: BAD })
  const pairs = deepFreeze([pair({ at: 1 }), pair({ at: 2 })])
  const existing = deepFreeze<Candidate[]>([])
  const raw = deepFreeze(JSON.parse(JSON.stringify(pairs)) as unknown)
  expect(noteFailure(opens, { tool: SQL, input: failIn, resultText: ERR_COL, at: 2000 })[0]!.attempts).toBe(2)
  expect(cure(opens, { tool: SQL, input: callIn, at: 3000 }).pairs).toHaveLength(1)
  expect(age(opens, 4000)[0]!.since).toBe(1)
  expect(addPairs(pairs, pairs)).toHaveLength(4)
  expect(asPairs(raw)).toHaveLength(2)
  expect(memory(pairs)).toHaveLength(1)
  expect(pairCandidates(pairs, existing, 5)).toHaveLength(1)
  expect(pairsSection(pairs, 0)).toHaveLength(4)
  expect(targetsOf({ tool: SQL, input: callIn })).toEqual(['workspace.todo_mirror'])
  expect(antigenOf({ tool: SQL, input: failIn, resultText: ERR_COL }).code).toBe('42703')
  expect(hits(opens[0]!, { tool: SQL, line: GOOD, targets: ['workspace.todo_mirror'] })).toBe(true)
  expect(opens[0]!.since).toBe(0)
  expect(opens[0]!.attempts).toBe(1)
})
