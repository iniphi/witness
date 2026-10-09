import { test, expect } from 'claude-code/testing'
import {
  MAX_NAMED,
  classify,
  covers,
  isTestRun,
  isUnder,
  namedTargets,
  normNotionId,
  normPath,
  notionIds,
  rowCount,
} from './classify'

// 1.1: what a subagent's report names, for a report that rests on no write the ledger knows.
test('namedTargets reads paths with a folder and an extension, schema tables and Notion ids, conservatively', () => {
  const id = '0123456789abcdef0123456789abcdef'
  const report = `Done. Wrote C:\\Work\\Proj\\src\\a.ts and mods/witness/hooks/b.tsx; read workspace.todo_mirror, called workspace.close_todo(), page ${id}. See https://example.com/x/y.html, v1.2 and and/or. README.md alone names no folder.`
  expect(namedTargets(report)).toEqual([
    { kind: 'file', target: 'c:/work/proj/src/a.ts' },
    { kind: 'file', target: 'mods/witness/hooks/b.tsx' },
    { kind: 'sql', target: 'workspace.todo_mirror' },
    { kind: 'notion', target: id },
  ])
  expect(namedTargets('Done, all good.')).toEqual([])
  const many = Array.from({ length: MAX_NAMED + 5 }, (_, i) => `src/f${i}.ts`).join(' ')
  expect(namedTargets(many)).toHaveLength(MAX_NAMED)
})

const call = (tool: string, input: Record<string, unknown>, resultText = '', isError = false, isReadOnly?: boolean) =>
  classify({ tool, input, resultText, isError, isReadOnly })
const bash = (command: string, resultText = '') => call('Bash', { command }, resultText)
const quiet = (command: string) => call('Bash', { command }, '', false, true)
const other = (target: string) => ({ kind: 'other', target, selfWitnessed: false })
const fileWrites = (c: { writes: Array<{ kind: string }> }) => c.writes.filter((w) => w.kind === 'file')
const fw = (target: string, selfWitnessed = false) => ({ kind: 'file', target, selfWitnessed })
const fr = (target: string) => ({ kind: 'file' as const, target })
const SQL = 'mcp__claude_ai_Supabase__execute_sql'
const wrap = (body: string) => `Result:\n<untrusted-data-abc123>\n${body}\n</untrusted-data-abc123>\nDone`
const ID = '0f1e2d3c4b5a49687786a5b4c3d2e1f0'
const ID2 = '1a2b3c4d5e6f40718293a4b5c6d7e8f9'
const NOTION = (n: string) => `mcp__claude_ai_Notion__${n}`

// ---- normalisation

test('normPath makes backslash, forward-slash and lower-case forms equal', () => {
  const a = normPath('C:\\Home\\X\\a.ts')
  expect(a).toBe('c:/home/x/a.ts')
  expect(normPath('C:/Home/X/a.ts')).toBe(a)
  expect(normPath('c:/home/x/a.ts')).toBe(a)
  expect(normPath('"C:/Home/X/dir/"')).toBe('c:/home/x/dir')
  expect(normPath('./src/a.ts')).toBe('src/a.ts')
})

// S164 live: Git Bash spells C:\x as /c/x, so a shell read-back never met a Write's path.
test('normPath reads a Git Bash drive path as the drive', () => {
  expect(normPath('/c/Home/X/a.ts')).toBe('c:/home/x/a.ts')
  expect(normPath('/C/Home/X/a.ts')).toBe('c:/home/x/a.ts')
  expect(normPath('/cd/x')).toBe('/cd/x')
  expect(normPath('/usr/lib')).toBe('/usr/lib')
})

test('isUnder respects the segment boundary', () => {
  expect(isUnder('c:/home/x/a.ts', normPath('C:/Home/X'))).toBe(true)
  expect(isUnder('c:/home/x/a.ts', normPath('C:/Home/Xy'))).toBe(false)
  expect(isUnder('c:/home/xy/a.ts', normPath('C:/Home/X'))).toBe(false)
})

test('Notion ids normalise from app URL, titled URL and dashed uuid', () => {
  expect(normNotionId(`https://app.notion.example/p/${ID}`)).toBe(ID)
  expect(normNotionId(`https://www.notion.example/Title-${ID}?pvs=4`)).toBe(ID)
  expect(normNotionId('0f1e2d3c-4b5a-4968-7786-a5b4c3d2e1f0')).toBe(ID)
  expect(normNotionId('0F1E2D3C4B5A49687786A5B4C3D2E1F0')).toBe(ID)
  expect(normNotionId('no id here')).toBeNull()
  expect(notionIds(`a ${ID} b ${ID} c`)).toEqual([ID])
  expect(notionIds('deadbeef'.repeat(5))).toEqual([])
})

test('covers: wider reads per kind', () => {
  expect(covers(fr('*'), fr('a.ts'))).toBe(true)
  expect(covers({ kind: 'git', target: 'git:*' }, { kind: 'git', target: 'git:push' })).toBe(true)
  expect(covers({ kind: 'migration', target: 'migration:*' }, { kind: 'migration', target: 'migration:x' })).toBe(true)
  expect(covers({ kind: 'notion', target: ID }, { kind: 'notion', target: 'notion:new' })).toBe(true)
  expect(covers({ kind: 'notion', target: ID }, { kind: 'notion', target: ID2 })).toBe(false)
  expect(covers({ kind: 'sql', target: 'a.b' }, { kind: 'sql', target: 'a.c' })).toBe(false)
  expect(covers({ kind: 'sql', target: 'a.b' }, fr('a.b'))).toBe(false)
})

// ---- built-in tools

test('an errored call classifies as nothing', () => {
  expect(call('Edit', { file_path: 'C:/a.ts' }, '', true)).toEqual({ writes: [], reads: [] })
})

test('Edit, Write and NotebookEdit are file writes; Read and Grep path are reads; Glob reads nothing', () => {
  expect(call('Edit', { file_path: 'C:\\X\\a.ts' }).writes).toEqual([fw('c:/x/a.ts')])
  expect(call('Write', { file_path: 'C:/X/b.ts', content: '' }).writes).toEqual([fw('c:/x/b.ts')])
  expect(call('NotebookEdit', { notebook_path: 'C:/X/n.ipynb', new_source: '' }).writes).toEqual([fw('c:/x/n.ipynb')])
  expect(call('Read', { file_path: 'C:/X/a.ts' })).toEqual({ writes: [], reads: [fr('c:/x/a.ts')] })
  expect(call('Grep', { pattern: 'x', path: 'C:/X' }).reads).toEqual([fr('c:/x')])
  expect(call('Glob', { pattern: '*.ts', path: 'C:/X/src' })).toEqual({ writes: [], reads: [] })
  expect(call('Grep', { pattern: 'x' })).toEqual({ writes: [], reads: [] })
})

test('an unknown tool classifies as nothing', () => {
  expect(call('WebSearch', { query: 'x' })).toEqual({ writes: [], reads: [] })
})

// ---- shell

test('git commit and push are git writes; status, log, show, diff, rev-parse are git:* reads', () => {
  expect(bash('git commit -F msg.txt').writes).toEqual([{ kind: 'git', target: 'git:commit', selfWitnessed: false }])
  expect(bash('git -C "C:/repo" push origin main').writes).toEqual([{ kind: 'git', target: 'git:push', selfWitnessed: false }])
  for (const sub of ['status', 'log --oneline -3', 'show HEAD', 'diff --staged', 'rev-parse HEAD']) {
    expect(bash(`git ${sub}`).reads).toEqual([{ kind: 'git', target: 'git:*' }])
  }
  expect(quiet('git add a.ts')).toEqual({ writes: [], reads: [] })
})

test('quoted separators do not split a command', () => {
  const c = bash('git commit -m "fix: a && b; c | d"')
  expect(c.writes).toEqual([{ kind: 'git', target: 'git:commit', selfWitnessed: false }])
  expect(c.reads).toEqual([])
})

test('a commit then a log in one command is witnessed inside the call', () => {
  expect(bash('git commit -F m.txt && git log -1').writes).toEqual([{ kind: 'git', target: 'git:commit', selfWitnessed: true }])
})

test('test and check runs read every file (*)', () => {
  for (const cmd of [
    'pytest -q', 'python -m pytest tests/', 'npm test', 'npm run test', 'npx vitest run',
    'claude plugin test "C:/mod"', 'claude plugin validate .', 'tsc --noEmit', 'npx tsc',
  ]) {
    expect(bash(cmd).reads).toEqual([fr('*')])
  }
  expect(isTestRun('cat pytest.ini')).toBe(false)
  expect(isTestRun('ls tsconfig.json')).toBe(false)
})

test('a test run is the command word, not a mention of one', () => {
  for (const cmd of [
    'pip install pytest', 'grep pytest .', 'tsc --version', 'tsc --help', 'npx tsc -v', 'echo npm test',
    'python x.py -m pytest', 'npm install vitest', 'claude plugin list', 'cat run_pytest.sh', 'git log --grep tsc',
  ]) expect(isTestRun(cmd)).toBe(false)
  for (const cmd of [
    'cd C:/repo && pytest -q', 'FOO=1 pytest', '.venv/Scripts/pytest.exe -q', 'python -X utf8 -m pytest',
    'npx -y -p typescript@5.6 tsc -p tsconfig.json', 'npx --yes vitest run', 'C:/node/tsc.cmd --noEmit',
  ]) expect(isTestRun(cmd)).toBe(true)
  expect(bash('pip install pytest').reads).toEqual([])
  expect(bash('grep pytest src/a.ts').reads).toEqual([fr('src/a.ts')])
  expect(bash('cd C:/repo && python -m pytest tests/ 2>&1 | tail -5').reads).toEqual([fr('*')])
})

test('cat, head, tail, grep, rg, sed -n and Get-Content with paths are file reads', () => {
  expect(bash('cat C:/X/a.ts b.ts').reads).toEqual([fr('c:/x/a.ts'), fr('b.ts')])
  expect(bash('head -n 40 a.ts').reads).toEqual([fr('a.ts')])
  expect(bash('tail -20 a.ts').reads).toEqual([fr('a.ts')])
  expect(bash('grep -n "foo bar" src/a.ts').reads).toEqual([fr('src/a.ts')])
  expect(bash('grep -e foo src/a.ts').reads).toEqual([fr('src/a.ts')])
  expect(bash('rg -C 2 foo src').reads).toEqual([fr('src')])
  expect(bash("sed -n '1,5p' a.ts").reads).toEqual([fr('a.ts')])
  expect(call('PowerShell', { command: 'Get-Content -Path C:\\X\\a.ts -TotalCount 5' }).reads).toEqual([fr('c:/x/a.ts')])
  expect(call('PowerShell', { command: 'gc a.ts' }).reads).toEqual([fr('a.ts')])
})

test('a pipe into grep reads nothing more; globs are not read targets', () => {
  expect(bash('git log | grep fix').reads).toEqual([{ kind: 'git', target: 'git:*' }])
  expect(bash('cat *.ts').reads).toEqual([])
  expect(quiet('cat *.ts')).toEqual({ writes: [], reads: [] })
})

test('sed -i, redirects, rm, mv, cp and tee are file writes', () => {
  expect(bash("sed -i 's|a|b|' C:/X/a.ts").writes).toEqual([fw('c:/x/a.ts')])
  expect(bash('echo hi > out.txt').writes).toEqual([fw('out.txt')])
  expect(bash('echo hi >> log.txt').writes).toEqual([fw('log.txt')])
  expect(bash('echo hi >out.txt').writes).toEqual([fw('out.txt')])
  expect(bash('rm -rf build tmp.txt').writes).toEqual([fw('build'), fw('tmp.txt')])
  expect(bash('mv a.ts b.ts').writes).toEqual([fw('a.ts'), fw('b.ts')])
  expect(bash('cp -r a.ts dest/b.ts').writes).toEqual([fw('dest/b.ts')])
  expect(bash('echo x | tee t.txt').writes).toEqual([fw('t.txt')])
})

test('redirects to sinks and fd duplications are not writes', () => {
  expect(bash('pytest 2>&1').writes).toEqual([])
  expect(fileWrites(bash('ls > /dev/null 2>&1'))).toEqual([])
  expect(fileWrites(call('PowerShell', { command: 'foo > $null' }))).toEqual([])
  expect(quiet('ls > /dev/null 2>&1')).toEqual({ writes: [], reads: [] })
})

test('PowerShell file cmdlets write their -Path, not their -Value', () => {
  expect(call('PowerShell', { command: 'Set-Content -Path a.txt -Value hello' }).writes).toEqual([fw('a.txt')])
  expect(call('PowerShell', { command: 'Remove-Item -Recurse -Force C:\\X\\old' }).writes).toEqual([fw('c:/x/old')])
  expect(call('PowerShell', { command: 'Copy-Item a.txt -Destination b.txt' }).writes).toEqual([fw('b.txt')])
})

test('inside one command a read after a write witnesses it, a read before does not', () => {
  expect(bash('echo x > a.txt && cat a.txt').writes).toEqual([fw('a.txt', true)])
  expect(bash('cat a.txt && echo x > a.txt').writes).toEqual([fw('a.txt', false)])
  expect(bash("sed -i 's/a/b/' a.ts; pytest").writes).toEqual([fw('a.ts', true)])
})

// ---- Supabase

test('rowCount reads the array inside the wrapper, escaped or not', () => {
  expect(rowCount(wrap('[{"id":"x"},{"id":"y"}]'))).toBe(2)
  expect(rowCount(wrap('[]'))).toBe(0)
  expect(rowCount(JSON.stringify(wrap('[{"id":"x"}]')))).toBe(1)
  expect(rowCount('{"status":"cancelled"}')).toBeNull()
  expect(rowCount('no rows [here')).toBeNull()
})

test('a bare UPDATE is an sql write, not self-witnessed', () => {
  const c = call(SQL, { project_id: 'p', query: "UPDATE workspace.todo_mirror SET status = 'Done' WHERE id = 'x'" }, wrap('[]'))
  expect(c.writes).toEqual([{ kind: 'sql', target: 'workspace.todo_mirror', selfWitnessed: false }])
  expect(c.reads).toEqual([])
})

test('an UPDATE with RETURNING is self-witnessed only when the result shows a row', () => {
  const q = "UPDATE workspace.todo_mirror SET status = 'Done' WHERE id = 'x' RETURNING id"
  expect(call(SQL, { query: q }, wrap('[{"id":"x"}]')).writes[0]?.selfWitnessed).toBe(true)
  expect(call(SQL, { query: q }, wrap('[]')).writes[0]?.selfWitnessed).toBe(false)
})

test('RETURNING inside a string literal does not count', () => {
  const q = "UPDATE workspace.t SET note = 'returning soon' WHERE id = 1"
  expect(call(SQL, { query: q }, wrap('[{"id":1}]')).writes[0]?.selfWitnessed).toBe(false)
})

test('a SELECT is an sql read and a migration:* read', () => {
  const c = call(SQL, { query: 'SELECT id FROM workspace.todo_mirror WHERE id = 1' }, wrap('[]'))
  expect(c.writes).toEqual([])
  expect(c.reads).toEqual([{ kind: 'sql', target: 'workspace.todo_mirror' }, { kind: 'migration', target: 'migration:*' }])
})

test('a SELECT-led writer function is an fn write, self-witnessed when a row shows', () => {
  const q = "SELECT workspace.close_todo('abc', 'done')"
  expect(call(SQL, { query: q }, wrap('[{"close_todo":"ok"}]')).writes).toEqual([
    { kind: 'sql', target: 'fn:workspace.close_todo', selfWitnessed: true },
  ])
  expect(call(SQL, { query: q }, wrap('[]')).writes[0]?.selfWitnessed).toBe(false)
})

test('a cancelled write stays unwitnessed and reads nothing', () => {
  const q = 'UPDATE workspace.t SET a = 1 WHERE id = 2 RETURNING id'
  expect(call(SQL, { query: q }, '{"status":"cancelled"}')).toEqual({
    writes: [{ kind: 'sql', target: 'workspace.t', selfWitnessed: false }],
    reads: [],
  })
})

test('an UPDATE then a SELECT of the same table in one call is witnessed; INSERT ... SELECT of itself is not', () => {
  const both = call(SQL, { query: 'UPDATE workspace.t SET a = 1 WHERE id = 2; SELECT a FROM workspace.t WHERE id = 2' }, wrap('[{"a":1}]'))
  expect(both.writes).toEqual([{ kind: 'sql', target: 'workspace.t', selfWitnessed: true }])
  const self = call(SQL, { query: 'INSERT INTO workspace.t (a) SELECT a FROM workspace.t' }, wrap('[]'))
  expect(self.writes).toEqual([{ kind: 'sql', target: 'workspace.t', selfWitnessed: false }])
})

test('apply_migration is a migration write; list_tables and list_migrations are migration:* reads', () => {
  expect(call('mcp__claude_ai_Supabase__apply_migration', { name: 'Add_Col', query: 'x' }).writes).toEqual([
    { kind: 'migration', target: 'migration:add_col', selfWitnessed: false },
  ])
  expect(call('mcp__claude_ai_Supabase__list_tables', {}).reads).toEqual([{ kind: 'migration', target: 'migration:*' }])
  expect(call('mcp__claude_ai_Supabase__list_migrations', {}).reads).toEqual([{ kind: 'migration', target: 'migration:*' }])
})

// ---- Notion

test('notion-update-page writes its page_id, not ids mentioned in its content', () => {
  const c = call(NOTION('notion-update-page'), {
    page_id: '0f1e2d3c-4b5a-4968-7786-a5b4c3d2e1f0',
    content_updates: [{ old_str: 'a', new_str: `see https://www.notion.example/${ID2}` }],
  })
  expect(c.writes).toEqual([{ kind: 'notion', target: ID, selfWitnessed: false }])
})

test('notion-move-pages writes the moved pages and the new parent', () => {
  const c = call(NOTION('notion-move-pages'), { page_or_database_ids: [ID], new_parent: { page_id: ID2 } })
  expect(c.writes.map((w) => w.target)).toEqual([ID, ID2])
})

test('notion creates write the ids in the result (not the parent), else notion:new', () => {
  const made = call(NOTION('notion-create-pages'), { parent: { data_source_id: ID2 }, pages: [] }, `created https://www.notion.example/${ID} under ${ID2}`)
  expect(made.writes).toEqual([{ kind: 'notion', target: ID, selfWitnessed: false }])
  const unknown = call(NOTION('notion-create-pages'), { parent: { page_id: ID2 } }, 'ok')
  expect(unknown.writes).toEqual([{ kind: 'notion', target: 'notion:new', selfWitnessed: false }])
})

test('notion-fetch and notion-query-data-sources are notion reads', () => {
  expect(call(NOTION('notion-fetch'), { id: `https://www.notion.example/Title-${ID}?pvs=4` }).reads).toEqual([{ kind: 'notion', target: ID }])
  const q = call(NOTION('notion-query-data-sources'), { data: { url: `collection://${ID2}` } }, `row https://www.notion.example/${ID}`)
  expect(q.reads.map((r) => r.target)).toEqual([ID2, ID])
  expect(call(NOTION('notion-fetch'), { id: 'search-result' }).reads).toEqual([{ kind: 'notion', target: 'notion:unknown' }])
})

// ---- RemoteTrigger

test('RemoteTrigger writes on create, update and run; reads on get and list', () => {
  expect(call('RemoteTrigger', { action: 'create', body: {} }, '{"id":"trig_01ABC"}').writes).toEqual([
    { kind: 'trigger', target: 'trigger:trig_01ABC', selfWitnessed: false },
  ])
  expect(call('RemoteTrigger', { action: 'update', trigger_id: 'trig_9' }).writes[0]?.target).toBe('trigger:trig_9')
  expect(call('RemoteTrigger', { action: 'run', trigger_id: 'trig_9' }).writes[0]?.target).toBe('trigger:trig_9')
  expect(call('RemoteTrigger', { action: 'create' }, 'ok').writes[0]?.target).toBe('trigger:new')
  expect(call('RemoteTrigger', { action: 'get', trigger_id: 'trig_9' }).reads).toEqual([{ kind: 'trigger', target: 'trigger:trig_9' }])
  expect(call('RemoteTrigger', { action: 'list' }).reads).toEqual([{ kind: 'trigger', target: 'trigger:*' }])
})

// ---- unknown writes (other:*)

test("the companion's own tools are never an other:* write (the confirm call must not pale its own turn)", () => {
  const confirm = call('mcp__witness__confirm', { asks: [1], evidence: [{ kind: 'call', ref: 'x', excerpt: 'y' }] }, 'confirmed 1 ask')
  expect(confirm).toEqual({ writes: [], reads: [] })
  expect(call('mcp__witness__anything_later', {}).writes).toEqual([])
  // Only the exact server segment: a lookalike server is still an unknown write.
  expect(call('mcp__witnessed__confirm', {}).writes).toEqual([other('other:mcp__witnessed__confirm')])
  expect(call('mcp__claude_ai_witness__confirm', {}).writes).toEqual([other('other:mcp__claude_ai_witness__confirm')])
})

test('an MCP or shell call that classifies to nothing, not read-only, is one other:* write', () => {
  expect(call(NOTION('notion-create-comment'), { page_id: ID })).toEqual({ writes: [other(`other:${NOTION('notion-create-comment')}`)], reads: [] })
  expect(call('mcp__claude_ai_Supabase__deploy_edge_function', { name: 'f' }).writes).toEqual([other('other:mcp__claude_ai_Supabase__deploy_edge_function')])
  expect(call('mcp__claude_ai_Gmail__send_message', { to: 'x' }).writes).toEqual([other('other:mcp__claude_ai_Gmail__send_message')])
  for (const cmd of ['python x.py --apply', 'git merge main', 'git reset --hard HEAD~1', 'git add a.ts']) {
    expect(bash(cmd)).toEqual({ writes: [other('other:shell')], reads: [] })
  }
  expect(call('PowerShell', { command: 'Invoke-Thing -Go' }).writes).toEqual([other('other:shell')])
})

test('a read-only, errored, or recognised call is not an other:* write', () => {
  expect(call(NOTION('notion-search'), { query: 'x' }, '', false, true)).toEqual({ writes: [], reads: [] })
  expect(quiet('python x.py --dry-run')).toEqual({ writes: [], reads: [] })
  expect(call(NOTION('notion-create-comment'), { page_id: ID }, 'boom', true)).toEqual({ writes: [], reads: [] })
  expect(bash('git status').writes).toEqual([])
  expect(call(NOTION('notion-fetch'), { id: ID }).writes).toEqual([])
})

test('read-only shell commands are known and make no other:shell write', () => {
  const live = [
    'git -C C:/x fetch -q',
    'diff <(git ls-tree -r --name-only origin/main mods/witness) <(git ls-files mods/witness) && echo same',
    'git ls-tree -r HEAD', 'git branch', 'git branch -a', 'git remote -v', 'ls -la', 'wc -l a.txt', 'find . -name x',
    'stat a', 'echo hi', 'printf x', 'pwd', 'which git', 'test -f a', '[ -f a ]', 'true', 'date', 'sort a',
    'cd x && ls', 'Get-ChildItem .', 'Test-Path a', 'Select-String -Pattern x', 'git log --oneline | head -3',
  ]
  for (const cmd of live) expect(bash(cmd).writes.filter((w) => w.kind === 'other')).toEqual([])
})

test('an unrecognised shell segment still makes other:shell, even beside a known one', () => {
  expect(bash('python scripts/apply.py --apply').writes).toEqual([other('other:shell')])
  expect(bash('git branch newname').writes).toEqual([other('other:shell')])
  expect(bash('git remote add o u').writes).toEqual([other('other:shell')])
  expect(bash('find . -delete').writes).toEqual([other('other:shell')])
  expect(bash('find . -exec rm {} ;').writes).toEqual([other('other:shell')])
  expect(bash('git status && python x.py').writes).toEqual([other('other:shell')])
})

// ---- S164 live: compound commands (bug B) and cd (bug C)

test('a for loop whose body only reads makes no other:shell write, and keeps its reads', () => {
  const c = bash('for d in a/*/; do grep -h version "$d/plugin.json"; cat b.txt; done')
  expect(c.writes).toEqual([])
  expect(c.reads).toContainEqual(fr('b.txt'))
})

test('if, then, else, fi and braces are classified by the command they wrap', () => {
  expect(bash('if [ -f a ]; then cat a; else echo no; fi').writes).toEqual([])
  expect(bash('{ cat a; }').writes).toEqual([])
  expect(bash('while true; do cat a; done > out.txt').writes).toEqual([fw('out.txt')])
  expect(bash('if true; then rm a; fi').writes).toEqual([fw('a')])
})

test('a loop that runs something unknown, or a header that runs a command, is still an unknown write', () => {
  expect(bash('for f in a b; do python x.py "$f"; done').writes).toEqual([other('other:shell')])
  expect(bash('for f in $(python make.py); do echo $f; done').writes).toContainEqual(other('other:shell'))
  expect(bash('for f in `python make.py`; do echo $f; done').writes).toContainEqual(other('other:shell'))
})

test('a cd earlier in the command resolves the relative paths after it', () => {
  expect(bash('cd C:/work/proj && cat src/a.ts').reads).toContainEqual(fr('c:/work/proj/src/a.ts'))
  expect(bash('cd /c/work/proj; cd hooks; grep -n x sql.ts').reads).toContainEqual(fr('c:/work/proj/hooks/sql.ts'))
  expect(bash('cd /c/work/proj/hooks && cat ../DESIGN.md').reads).toContainEqual(fr('c:/work/proj/design.md'))
  expect(bash('cd /c/work && echo hi > out.txt').writes).toEqual([fw('c:/work/out.txt')])
  const ps = call('PowerShell', { command: 'Set-Location -Path C:\\work; Get-Content a.ts' })
  expect(ps.reads).toContainEqual(fr('c:/work/a.ts'))
  // Every cd word changes no file: none of them is an unknown write.
  expect(ps.writes).toEqual([])
  const pushed = bash('pushd /c/work && cat a.ts && popd && cat b.ts')
  expect(pushed.writes).toEqual([])
  expect(pushed.reads).toEqual([fr('c:/work/a.ts'), fr('b.ts')])
})

test('a cd-resolved read-back witnesses an absolute-path write in the same command', () => {
  const c = bash('echo x > C:/work/log.md && cd /c/work && cat log.md')
  expect(c.writes).toEqual([fw('c:/work/log.md', true)])
})

test('paths a cd cannot place are left as they were', () => {
  expect(bash('cd /c/work && cat C:/other/a.ts').reads).toContainEqual(fr('c:/other/a.ts'))
  expect(bash('cat src/a.ts').reads).toContainEqual(fr('src/a.ts'))
  expect(bash('cd hooks && cat sql.ts').reads).toContainEqual(fr('hooks/sql.ts'))
  // Home, the previous directory and a variable are places the classifier cannot know.
  for (const where of ['~', '-', '$DIR', '']) {
    expect(bash(`cd /c/work && cd ${where} && cat a.ts`.replace('cd  &&', 'cd &&')).reads).toContainEqual(fr('a.ts'))
  }
  expect(bash('cd /c/work && cat "$d/x.ts"').reads).toContainEqual(fr('$d/x.ts'))
})

// S164: a write inside a substitution was classed by the outer word alone (`echo` - a read),
// so a claim could develop while that write went unseen. Each substitution is its own command.
test('a command substitution runs as a command of its own', () => {
  expect(bash('echo $(rm x)').writes).toContainEqual(fw('x'))
  expect(bash('echo "$(rm x)"').writes).toContainEqual(fw('x'))
  expect(bash('echo `rm x`').writes).toContainEqual(fw('x'))
  expect(bash('diff <(rm x) y').writes).toContainEqual(fw('x'))
  expect(bash('echo $(echo $(rm x))').writes).toContainEqual(fw('x'))
  expect(bash('echo $(python apply.py)').writes).toEqual([other('other:shell')])
  expect(bash('for f in $(python make.py); do echo $f; done').writes).toEqual([other('other:shell')])
})

test('a read-only substitution, arithmetic and a literal $( stay read-only', () => {
  const live = [
    'echo $(git rev-parse --short HEAD)', 'echo "$(date)"', 'echo $((1 + 2))', "echo '$(rm x)'",
    'echo \\$(rm x)', 'for f in $(ls); do cat "$f"; done', 'git -C $(pwd) status', 'grep -n "<(" a.ts',
  ]
  for (const cmd of live) expect(bash(cmd).writes).toEqual([])
})

test('an unbalanced substitution is an unknown write', () => {
  expect(bash('echo $(rm x').writes).toContainEqual(other('other:shell'))
  expect(bash('echo `rm x').writes).toContainEqual(other('other:shell'))
})

test('a redirect after echo is still a file write, and no other write', () => {
  expect(bash('echo hi > out.txt')).toEqual({ writes: [fw('out.txt')], reads: [] })
})

test('built-in non-shell tools never make an other:* write', () => {
  for (const tool of ['Agent', 'Skill', 'ToolSearch', 'AskUserQuestion', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'WebSearch', 'WebFetch', 'Glob', 'Grep', 'Read', 'RemoteTrigger']) {
    expect(call(tool, {})).toEqual({ writes: [], reads: [] })
  }
})

test('nothing witnesses an other:* write, not even the same target or a wide read', () => {
  const w = { kind: 'other' as const, target: 'other:shell' }
  expect(covers(w, w)).toBe(false)
  expect(covers(fr('*'), w)).toBe(false)
})
