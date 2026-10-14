// The jewel charter (1.11.0, ruled by Bradley 2026-10-11): the first-week display budget, and the
// generator rules that keep the candidate pass from minting shapes already ruled out. Pure; imports
// only types, so notes.ts can use it without a cycle.

import type { Candidate } from '../types'
import { isDismissed } from './ruling'

// --- B: the first-week budget ----------------------------------------------------------------------

/** A new install shows at most this many new jewels a day... */
export const FIRST_WEEK_PER_DAY = 3
/** ...for this many days after the first candidate pass it ever ran. */
export const FIRST_WEEK_DAYS = 7
const DAY_MS = 24 * 60 * 60_000

/** The store key that holds when the witness first ran a candidate pass on this machine. */
export const INSTALL_KEY = 'install:firstScanAt'

/** The stored first-scan time, or null when absent or not a finite number. */
export const asFirstScanAt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/**
 * The jewels to show and the jewels held back. Display only: nothing is dropped, settled or minted
 * differently. Within the first week from `firstScanAt` the allowance is 3 jewels per 24 h window
 * elapsed (counting this one), cumulative, over every jewel minted since the install in the order
 * minted, settled ones included (they were shown). Jewels minted before the install are always
 * shown. A held jewel is shown on a later day, so it is queued, never lost. After the week, or with
 * no install time, everything unsettled shows. `shown` and `queued` keep the order given.
 */
export function applyBudget(
  candidates: readonly Candidate[],
  firstScanAt: number | null,
  now: number,
): { shown: Candidate[]; queued: Candidate[] } {
  const waiting = candidates.filter(c => c.settled === undefined)
  if (firstScanAt === null || now - firstScanAt >= FIRST_WEEK_DAYS * DAY_MS) {
    return { shown: waiting.map(c => ({ ...c })), queued: [] }
  }
  const window = Math.max(0, Math.floor((now - firstScanAt) / DAY_MS))
  const allowance = FIRST_WEEK_PER_DAY * (window + 1)
  const since = candidates.filter(c => c.at >= firstScanAt).sort((a, b) => a.at - b.at)
  const allowed = new Set(since.slice(0, allowance).map(c => c.key))
  const shown: Candidate[] = []
  const queued: Candidate[] = []
  for (const c of waiting) {
    if (c.at < firstScanAt || allowed.has(c.key)) shown.push({ ...c })
    else queued.push({ ...c })
  }
  return { shown, queued }
}

/** The pane's and /jewels' note when some jewels are held; '' when none are. */
export const queuedLine = (n: number): string => (n > 0 ? `${n} more queued (first-week budget)` : '')

// --- A: the gap exception --------------------------------------------------------------------------

/** One-session candidates a single pass may mint, each naming a gap. */
export const MAX_GAP_CANDIDATES = 1
export const GAP_CHARS = 120
export const GAP_WHY = 'one session, a gap'

// --- C1: shapes dismissed before -------------------------------------------------------------------

export const MAX_DISMISSED_SHOWN = 40
const DISMISSED_CHARS = 80

/** The titles of dismissed jewels across projects, deduped (case and spacing ignored), capped. */
export function dismissedTitles(lists: ReadonlyArray<readonly Candidate[]>, max = MAX_DISMISSED_SHOWN): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of lists.flat()) {
    if (!isDismissed(c)) continue
    const title = c.title.replace(/\s+/g, ' ').trim()
    const key = title.toLowerCase()
    if (title === '' || seen.has(key)) continue
    seen.add(key)
    out.push(title.length <= DISMISSED_CHARS ? title : `${title.slice(0, DISMISSED_CHARS - 3)}...`)
    if (out.length >= max) break
  }
  return out
}

// --- C2: the real hook list, and no test hooks -----------------------------------------------------

export const MAX_HOOK_LINES = 40
const SCRIPT_TOKEN = /([^\s"'\\/]+\.(?:py|js|mjs|cjs|ts|sh|bash|ps1|bat|cmd))\b/i

/** A hook command's script basename: the first script-looking token's file name, else the command word's. */
export function hookScript(command: string): string {
  const hit = SCRIPT_TOKEN.exec(command)
  if (hit !== null && hit[1] !== undefined) return hit[1]
  const word = (command.trim().split(/\s+/)[0] ?? '').replace(/^["']|["']$/g, '')
  const base = word.split(/[\\/]/).pop() ?? ''
  return base === '' ? 'command' : base
}

/**
 * The hooks configured in settings files' text: `- <event> <matcher>: <script>`, never a full
 * command or a path. Unparseable text is skipped. Deduped, capped.
 */
export function configuredHooks(settingsTexts: readonly string[], max = MAX_HOOK_LINES): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const text of settingsTexts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const hooks = (parsed as { hooks?: unknown } | null)?.hooks
    if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) continue
    for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(groups)) continue
      for (const g of groups) {
        const group = g as { matcher?: unknown; hooks?: unknown }
        const matcher = typeof group?.matcher === 'string' && group.matcher !== '' ? group.matcher : 'all'
        const list = Array.isArray(group?.hooks) ? group.hooks : []
        for (const h of list) {
          const command = (h as { command?: unknown })?.command
          const kind = (h as { type?: unknown })?.type
          const what = typeof command === 'string' ? hookScript(command) : typeof kind === 'string' ? `${kind} hook` : 'hook'
          const line = `- ${event.slice(0, 40)} ${matcher.slice(0, 60)}: ${what.slice(0, 60)}`
          if (seen.has(line)) continue
          seen.add(line)
          out.push(line)
          if (out.length >= max) return out
        }
      }
    }
  }
  return out
}

const TESTY = /\b(tests?|test suite|pytest|vitest|jest|typecheck|type-check|type check|tsc|build|lint|linter|compile)\b/i
const AFTER_EDIT = /\b(?:after|on|post|following|whenever|each|every)[- ]+(?:an? |the |any |each |every )?(?:file )?(?:edit|edits|editing|edited|save|saves|saving|saved|change|changes|changing)\b|\bpost-edit\b/i

/** A hook proposal to run tests, typecheck or build after an edit: test-first work, the red phase. */
export function isTestAfterEditHook(title: string): boolean {
  return TESTY.test(title) && AFTER_EDIT.test(title)
}

// --- C4: a skill is a procedure --------------------------------------------------------------------

const TAG_SPLIT = /\[(?:s[0-9a-f?]{1,6}\s*)?(?:t\d+)?\]/g

/** The distinct call heads an evidence text cites: `Tool: input` segments, or a segment's first word. */
export function evidenceHeads(evidence: string): Set<string> {
  const heads = new Set<string>()
  for (const raw of evidence.split(TAG_SPLIT)) {
    const seg = raw.replace(/^[\s,;.-]+|[\s,;.-]+$/g, '')
    if (seg === '') continue
    const m = /^([A-Za-z][\w-]*):\s*(\S.*)$/.exec(seg)
    if (m !== null && m[1] !== undefined && m[2] !== undefined) {
      const tool = m[1]
      const rest = m[2]
      if (tool === 'Bash' || tool === 'PowerShell') {
        const words = rest.replace(/^\s*cd\s+\S+\s*(?:&&|;)\s*/, '').split(/\s+/)
        heads.add(`${(words[0] ?? '').toLowerCase()}${words[0] === 'git' && words[1] !== undefined ? ` ${words[1]}` : ''}`)
      } else {
        heads.add(tool.toLowerCase())
      }
    } else {
      // A plain segment may hold several routine heads ("12 calls; git add"): each part's first
      // word, with git's subcommand, as the routines digest writes them.
      for (const part of seg.split(';')) {
        const words = part.trim().split(/\s+/)
        const first = (words[0] ?? '').toLowerCase()
        heads.add(first === 'git' && words[1] !== undefined ? `git ${words[1].toLowerCase()}` : first)
      }
    }
  }
  heads.delete('')
  // A count ("12 calls") is not a call head: only a name can be.
  return new Set([...heads].filter((h) => /^[a-z_]/.test(h)))
}

/** Does a skill candidate's evidence cite at least two distinct call heads? A single call is not a procedure. */
export const hasProcedureShape = (evidence: string): boolean => evidenceHeads(evidence).size >= 2
