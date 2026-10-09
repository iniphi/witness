// The estate ticket: the project tag, its board inbox, open Code to-dos and the push
// verdict, read from scripts/estate-status.py (1.0: an adapter, found or configured at
// session start; with no script there is no ticket, never `estate: ?`). Folded in from the estate-status mod
// (0.2.5) in 0.3.0 (Bradley, S165): two mods composing one band depended on which
// loaded first, and the engine gives no say over that, so the witness draws it alone.

import type { Ticket } from '../types'

export const TICKET_MS = 10 * 60_000
export const BAR_GLYPH = '\u258c'

export const UNAVAILABLE_TICKET: Ticket = { kind: 'unavailable' }

export type EstateStatus = {
  board_id?: string | null
  inbox_open?: number | null
  code_todos_open?: number | null
  metered?: string | null
}

/**
 * Project colours by board_id. Source: the Notion Global To-Do "Project" select
 * (Overseer red, Project Manager blue, Brand Manager yellow, The Stacks green,
 * Voice purple, HomeLab gray), ruled by Bradley 2026-10-06. Mid-tones that read on
 * light and dark terminals. Router is "default" there, so it carries no entry; any
 * other or null board_id gets no bar.
 */
export const BOARD_COLOURS: Readonly<Record<string, string>> = {
  overseer: '#D44C47',
  pm: '#447ACB',
  brand: '#CB912F',
  stacks: '#4C8F69',
  voice: '#9065B0',
  homelab: '#9B9A97',
}

/** The colour for a board, or null (no bar, default-colour tag). */
export function colourFor(board: string | null | undefined): string | null {
  if (board === null || board === undefined) return null
  return Object.prototype.hasOwnProperty.call(BOARD_COLOURS, board) ? (BOARD_COLOURS[board] ?? null) : null
}

const show = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '?' : String(v)

/** The ticket's parts, every count already display text. A null shows as `?`, never 0. */
export function ticketFromStatus(st: EstateStatus): Ticket {
  const inbox = typeof st.inbox_open === 'number' ? st.inbox_open : null
  return {
    kind: 'ok',
    colour: colourFor(st.board_id),
    tag: show(st.board_id),
    inbox: show(st.inbox_open),
    todos: show(st.code_todos_open),
    push: show(st.metered),
    warnInbox: inbox !== null && inbox > 0,
    warnPush: st.metered === 'METERED',
  }
}

/**
 * Parses the helper's stdout. Exit 2 means the database was unreachable but the JSON
 * is still printed (partial); no run, any other exit, or output that is not a JSON
 * object, is a failure and yields the unavailable ticket.
 */
export function ticketFromRun(run: { exitCode: number; stdout: string } | null): Ticket {
  if (run === null || (run.exitCode !== 0 && run.exitCode !== 2)) return UNAVAILABLE_TICKET
  try {
    const parsed: unknown = JSON.parse(run.stdout)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return UNAVAILABLE_TICKET
    return ticketFromStatus(parsed as EstateStatus)
  } catch {
    return UNAVAILABLE_TICKET
  }
}
