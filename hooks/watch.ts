// Pure module: turns witness-watch.py output into WatchInfo and the words said at
// the start of a watch. No Node, no `$`, no clock.
import type { BoardRow, WatchInfo } from '../types'

type Run = { exitCode: number; stdout: string }

const SUMMARY_MAX = 100

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseObject(run: Run): Record<string, unknown> | null {
  if (run.exitCode !== 0 && run.exitCode !== 2) return null
  try {
    const parsed: unknown = JSON.parse(run.stdout)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toRow(raw: unknown): BoardRow | null {
  if (!isObject(raw)) return null
  const id = str(raw.id)
  if (id === null) return null
  return {
    id,
    from: str(raw.agent_from) ?? '',
    subject: str(raw.subject) ?? '',
    createdAt: str(raw.created_at) ?? '',
  }
}

function toRows(raw: unknown): BoardRow[] | null {
  if (!Array.isArray(raw)) return null
  return raw.map(toRow).filter((r): r is BoardRow => r !== null)
}

function toSession(raw: unknown): WatchInfo['lastSession'] {
  if (!isObject(raw)) return null
  const number = num(raw.session_number)
  if (number === null) return null
  const outstanding = Array.isArray(raw.outstanding)
    ? raw.outstanding.filter((o): o is string => typeof o === 'string')
    : []
  return { number, date: str(raw.date) ?? '', summary: str(raw.summary), outstanding }
}

export function parseWatch(run: Run): WatchInfo | null {
  const obj = parseObject(run)
  if (obj === null) return null
  return {
    project: str(obj.project),
    boardId: str(obj.board_id),
    lastSession: toSession(obj.last_session),
    focus: str(obj.focus),
    inbox: toRows(obj.inbox),
    codeTodosOpen: num(obj.code_todos_open),
    metered: str(obj.metered),
    errors: Array.isArray(obj.errors) ? obj.errors.filter((e): e is string => typeof e === 'string') : [],
  }
}

export function parseRows(run: Run): BoardRow[] | null {
  const obj = parseObject(run)
  return obj === null ? null : toRows(obj.inbox)
}

export function watchHeader(info: WatchInfo): string {
  if (info.lastSession === null) return 'WATCH'
  const n = info.lastSession.number
  return `WATCH S${n} -> S${n + 1}`
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const m = /^.*?[.!?](?=\s|$)/.exec(flat)
  const sentence = m ? m[0] : flat
  return sentence.length <= SUMMARY_MAX ? sentence : sentence.slice(0, SUMMARY_MAX - 3).trimEnd() + '...'
}

function boardLine(inbox: BoardRow[]): string {
  if (inbox.length === 0) return '0 open board rows'
  const noun = inbox.length === 1 ? 'open board row' : 'open board rows'
  return `${inbox.length} ${noun}, oldest: ${inbox[0]?.subject}`
}

export function watchText(info: WatchInfo): string {
  const lines: string[] = []
  if (info.focus) lines.push(`Focus: ${info.focus}`)
  if (info.lastSession) {
    const s = info.lastSession
    lines.push(s.summary ? `Last: ${firstSentence(s.summary)}` : `Last: S${s.number} (${s.date})`)
  }
  if (info.inbox !== null) lines.push(boardLine(info.inbox))
  if (info.codeTodosOpen !== null) {
    lines.push(`${info.codeTodosOpen} open Code to-dos`)
  }
  if (info.errors.length > 0) lines.push(`note: ${info.errors[0]}`)
  const kept = lines.slice(0, 5)
  if (kept.length === 0) return 'Nothing measured.\nnote: the watch could not be read'
  if (kept.length === 1) kept.push('note: the rest was not measured')
  return kept.join('\n')
}

export function landedRows(previousIds: readonly string[], info: WatchInfo): BoardRow[] {
  const seen = new Set(previousIds)
  return (info.inbox ?? []).filter((r) => !seen.has(r.id))
}
