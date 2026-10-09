import { test, expect } from 'claude-code/testing'

import { rootFromModuleUrl, scriptCandidates, TICKET_SCRIPT } from './config'

// The second word on where the mod is (1.1): the hooks module's own URL, for when the
// engine's $.plugin.root is blank, as it was the morning the estate line vanished.
test('rootFromModuleUrl reads the mod folder from a Windows or POSIX file URL of a hooks module', () => {
  expect(rootFromModuleUrl('file:///C:/x/repo/mods/witness/hooks/register.tsx')).toEqual('C:/x/repo/mods/witness')
  expect(rootFromModuleUrl('file:///home/x/mods/witness/hooks/register.js')).toEqual('/home/x/mods/witness')
  expect(rootFromModuleUrl('file:///C:/a%20b/mods/witness/hooks/register.tsx')).toEqual('C:/a b/mods/witness')
})

test('rootFromModuleUrl is blank for anything that is not a file URL under a hooks folder', () => {
  expect(rootFromModuleUrl(undefined)).toEqual('')
  expect(rootFromModuleUrl('')).toEqual('')
  expect(rootFromModuleUrl('https://example.org/hooks/register.tsx')).toEqual('')
  expect(rootFromModuleUrl('file:///C:/x/mods/witness/register.tsx')).toEqual('')
})

test('a root from the module URL reaches the repository scripts folder two levels up', () => {
  const root = rootFromModuleUrl('file:///C:/x/repo/mods/witness/hooks/register.tsx')
  expect(scriptCandidates('', root, 'C:/elsewhere', TICKET_SCRIPT)).toEqual([
    'C:/x/repo/mods/witness/scripts/estate-status.py',
    'C:/x/repo/mods/scripts/estate-status.py',
    'C:/x/repo/scripts/estate-status.py',
  ])
})
