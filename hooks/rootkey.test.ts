import { test, expect } from 'claude-code/testing'

import { projectKey, rootOf } from './support'

// witness 1.11.1: a project is its repository. A session started in a subfolder keys to the
// repo root, found by the nearest `.git` entry (a folder, or a file in a git worktree).

const has = (...paths: string[]) => async (p: string): Promise<boolean> => paths.includes(p)

test('the repo root is its own root', async () => {
  expect(await rootOf('d:/work/proj', has('d:/work/proj/.git'))).toEqual('d:/work/proj')
})

test('a nested subfolder finds the root above it, and gives the same key as the root', async () => {
  const exists = has('d:/work/proj/.git')
  const sub = await rootOf('d:/work/proj/mods/witness/hooks', exists)
  expect(sub).toEqual('d:/work/proj')
  expect(projectKey(sub ?? '')).toEqual(projectKey((await rootOf('d:/work/proj', exists)) ?? ''))
})

test('a worktree .git FILE counts the same as a .git folder (the existence check does not care)', async () => {
  expect(await rootOf('d:/work/wt/lane/mods', has('d:/work/wt/lane/.git'))).toEqual('d:/work/wt/lane')
})

test('the nearest .git wins over an outer one', async () => {
  const exists = has('d:/work/.git', 'd:/work/proj/.git')
  expect(await rootOf('d:/work/proj/src', exists)).toEqual('d:/work/proj')
})

test('with no repository the answer is null, so the caller keys by the cwd', async () => {
  expect(await rootOf('d:/work/proj/src', has())).toBeNull()
})

test('Windows backslashes, drive letters and trailing slashes are normalised', async () => {
  const exists = has('C:/Work/Proj/.git')
  expect(await rootOf('C:\\Work\\Proj\\mods\\x\\', exists)).toEqual('C:/Work/Proj')
  expect(await rootOf('C:/Work/Proj///', exists)).toEqual('C:/Work/Proj')
})

test('a repository at a drive root or at / is found', async () => {
  expect(await rootOf('C:/a/b', has('C:/.git'))).toEqual('C:')
  expect(await rootOf('/a/b', has('/.git'))).toEqual('')
})

test('the walk is capped, and an existence check that throws counts as absent', async () => {
  const deep = `d:/${Array.from({ length: 60 }, (_, i) => `d${i}`).join('/')}`
  expect(await rootOf(deep, has('d:/.git'))).toBeNull()
  expect(await rootOf('d:/work/proj', async () => { throw new Error('no') })).toBeNull()
})
