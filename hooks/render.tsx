// The trees: the band above the prompt, and the /undone pane. These take the
// surface's element table (`$.ui.resolve(e)`), never `$` itself: the engine follows
// `$` only within the hooks module's own file.

import type { Barnacle, Claim, Ticket } from '../types'
import type { PaneRow } from './asks'
import { DISMISS_KEY, DISMISS_LABEL, countText, footerRow, footerText, wrapLines } from './notices'
import { INKS } from './body'
import { BAR_GLYPH } from './ticket'
import { SAFELIGHT, SPRITE_WIDTH } from './view'
import type { View } from './view'

/** The estate-status ticket marks its trees with these keys (estate-status 0.2.4+). */
export const TICKET_BAND_KEY = 'estate-band'

type Beneath = { ticket: unknown; note: unknown; engine: unknown }

function isEngine(el: any): boolean {
  return el === null || el === undefined || el.type === 'engine'
}

/**
 * Pulls apart what stood beneath the companion. When the ticket's band is beneath
 * (witness above estate-status), its first child is the ticket line and its second
 * whatever stood beneath the ticket. Anything else beneath that draws (Claude Code's
 * own "Heads up" note) is a note the companion voices in its bubble. The engine's
 * own element is kept, drawn last, so nothing of the engine's is ever dropped.
 */
export function splitBeneath(below: any): Beneath {
  if (below?.props?.key === TICKET_BAND_KEY && Array.isArray(below.children)) {
    const [ticket, rest] = below.children
    return isEngine(rest) ? { ticket, note: null, engine: rest } : { ticket, note: rest, engine: null }
  }
  return isEngine(below) ? { ticket: null, note: null, engine: below } : { ticket: null, note: below, engine: null }
}

/** The words of a tree: a Text's runs joined as drawn, a Box's children apart; the engine's own element has none. */
function treeWords(el: any, inText: boolean): string {
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (Array.isArray(el)) return el.map(child => treeWords(child, inText)).join(inText ? '' : ' ')
  if (el === null || typeof el !== 'object' || el.type === 'engine') return ''
  if (el.type === 'Button') return typeof el.props?.label === 'string' ? ` ${el.props.label} ` : ''
  const children = el.children ?? el.props?.children
  return treeWords(children, inText || el.type === 'Text')
}

/**
 * The text of the note from beneath (Claude Code's own "Heads up"), whitespace collapsed;
 * '' when nothing but the ticket and the engine stands beneath. Render trees are plain
 * data, strings as children (RenderElement), so the words are readable as drawn.
 */
export function beneathText(below: unknown): string {
  return treeWords(splitBeneath(below).note, false).replace(/\s+/g, ' ').trim()
}

/** Border (2) and padding (2) around a bubble's contents. */
const BUBBLE_FRAME = 4

/**
 * A note from beneath sized itself to the whole band (`width: bodyColumns`); set
 * inside the narrower bubble it spilled off the band's left edge and was cut (seen
 * live, S162). Every numeric width wider than `max` comes down to `max`; strings
 * (a Text's words), percentages, the engine's own element and every other prop,
 * a Button's press handle included, pass through untouched.
 */
export function fitWidth(el: any, max: number): any {
  if (Array.isArray(el)) return el.map(child => fitWidth(child, max))
  if (el === null || typeof el !== 'object' || el.type === 'engine') return el
  const props = el.props ?? {}
  const w = props.width
  const next = typeof w === 'number' && w > max ? { ...props, width: max } : props
  const out = next === props ? { ...el } : { ...el, props: next }
  return el.children === undefined ? out : { ...out, children: fitWidth(el.children, max) }
}

/**
 * The bubble's outer width: a note takes the room there is; the companion's own words, what
 * they need, with the footer (`0: Dismiss <n/m>`) beside the text when there is one.
 */
export function bubbleWidth(room: number, voice: { header: string; text: string } | null, footer = ''): number {
  if (voice === null) return Math.max(BUBBLE_FRAME + 1, room)
  const text = footer === '' ? voice.text.length : voice.text.length + 1 + footer.length
  const words = Math.max(voice.header.length, text) + BUBBLE_FRAME
  return Math.max(BUBBLE_FRAME + 1, Math.min(room, words))
}

/** What the queue puts in the bubble's footer; `onDismiss` null when the notice showing is not the witness's to dismiss. */
export type QueueFooter = { n: number; m: number; onDismiss: (() => unknown) | null }

export const NO_FOOTER: QueueFooter = { n: 0, m: 0, onDismiss: null }

function isDismissButton(el: any): boolean {
  if (el?.type !== 'Button') return false
  const p = el.props ?? {}
  return p.role === 'dismiss' || p.hotkey === DISMISS_KEY || /dismiss/i.test(String(p.label ?? ''))
}

function isRowBox(el: any): boolean {
  const d = el?.props?.flexDirection
  return el?.type === 'Box' && (d === undefined || d === 'row')
}

/**
 * The note from beneath with `count` set just after its own Dismiss control, on the same
 * row, so it never grows taller. Placed only where that control sits in a row Box; anywhere
 * else the note is returned untouched and `placed` is false.
 */
export function withCount(note: any, count: any): { tree: any; placed: boolean } {
  if (Array.isArray(note)) {
    let placed = false
    const tree = note.map(child => {
      if (placed) return child
      const r = withCount(child, count)
      placed = r.placed
      return r.tree
    })
    return { tree, placed }
  }
  if (note === null || typeof note !== 'object' || note.type === 'engine') return { tree: note, placed: false }
  const children = note.children
  if (isRowBox(note) && Array.isArray(children) && children.some(isDismissButton)) {
    return { tree: { ...note, children: [...children, count] }, placed: true }
  }
  if (children === undefined) return { tree: note, placed: false }
  const r = withCount(children, count)
  return r.placed ? { tree: { ...note, children: r.tree }, placed: true } : { tree: note, placed: false }
}

/** `0: Dismiss` (the key bound only while it is drawn) and `<n/m>`, either absent when it does not apply. */
function footerTree(t: any, footer: QueueFooter, ink: string | undefined): any {
  const { Box, Button, Text } = t
  const count = countText(footer.n, footer.m)
  const onDismiss = footer.onDismiss
  return (
    <Box flexDirection="row" flexShrink={0} marginLeft={1}>
      {onDismiss !== null && (
        <Button key="witness-dismiss" label={DISMISS_LABEL} hotkey={DISMISS_KEY} plain onPress={() => onDismiss()} />
      )}
      {count !== '' && <Text dimColor={ink === undefined} color={ink}>{onDismiss !== null ? ` ${count}` : count}</Text>}
    </Box>
  )
}

/** The companion's own words, the footer on the last text row or, where it does not fit, the header row. */
function voiceTree(t: any, voice: { header: string; text: string }, inner: number, footer: QueueFooter, ink: string | undefined): any {
  const { Box, Text } = t
  const foot = footerText(footer.onDismiss !== null, footer.n, footer.m)
  if (foot === '') {
    return (
      <Box flexDirection="column">
        <Text bold color={ink} wrap="truncate-end">
          {voice.header}
        </Text>
        <Text color={ink}>{voice.text}</Text>
      </Box>
    )
  }
  // Pre-wrapped, each row cut rather than rewrapped, so the footer adds no row.
  const lines = wrapLines(voice.text, inner)
  const place = footerRow(lines, inner, foot)
  const row = (key: string, text: string, bold: boolean, withFooter: boolean) => (
    <Box key={key} flexDirection="row">
      <Box flexGrow={1} flexShrink={1}>
        <Text bold={bold} color={ink} wrap="truncate-end">
          {text}
        </Text>
      </Box>
      {withFooter && footerTree(t, footer, ink)}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {row('h', voice.header, true, place === 'header')}
      {lines.map((line, i) => row(`l${i}`, line, false, place === 'last' && i === lines.length - 1))}
    </Box>
  )
}


/** The speech-bubble tail column: `>` on the creature's eye row, blank elsewhere. */
function tail(t: any, rows: number, eyeRow: number, show: boolean, ink: string | undefined): any {
  const { Box, Text } = t
  return (
    <Box flexDirection="column" flexShrink={0} width={1}>
      {Array.from({ length: rows }, (_, i) => (
        <Text key={`t${i}`} color={ink}>
          {show && i === eyeRow ? '>' : ' '}
        </Text>
      ))}
    </Box>
  )
}

/**
 * Bradley's one line (S162): the estate ticket cut to inbox and Code to-dos, the
 * companion's counts appended. No push verdict and no log name: a metered repo shows
 * as the creature's eyes in warning colour instead (S165, the line had no room). Before
 * the ticket is first read, the counts alone; one that could not be read shows as
 * `estate: ?`, never zeros.
 */
function ticketLine(t: any, ticket: Ticket | null, status: string, ink: string | undefined): any {
  const { Text } = t
  if (ticket === null) {
    return (
      <Text color={ink} dimColor={ink === undefined} wrap="truncate-end">
        {status}
      </Text>
    )
  }
  if (ticket.kind === 'unavailable') {
    return (
      <Text wrap="truncate-end">
        <Text dimColor>estate: ?</Text>
        <Text color={ink}>{` · ${status}`}</Text>
      </Text>
    )
  }
  // ONE text run with inline spans, cut at the edge rather than wrapped: sibling Text
  // elements lay out as flex columns, each wrapping on its own (seen 2026-10-06).
  return (
    <Text wrap="truncate-end">
      {ticket.colour !== null ? <Text color={ticket.colour}>{`${BAR_GLYPH} `}</Text> : null}
      <Text color={ticket.colour ?? undefined} bold>
        {ticket.tag}
      </Text>
      {': inbox '}
      <Text color={ticket.warnInbox ? 'warning' : undefined}>{ticket.inbox}</Text>
      {` · Code to-dos ${ticket.todos}`}
      <Text color={ink}>{` · ${status}`}</Text>
    </Text>
  )
}

/** A cell on a sprite row that takes its own ink. */
export type InkSpan = { col: number; color: string }

/**
 * The cells on sprite row `row` that take their own ink, left to right: the worn costume in
 * red, the chime in the bells' ink, the barnacles in theirs (1.1), and the eyes in the
 * warning colour when the repo is metered, so a push would be held (S165). An eye drawn
 * over by a costume still counts as an eye: the cell table, not the glyph, says where it is.
 */
export function rowInks(view: View, row: number, meteredEyes: boolean): InkSpan[] {
  const at = (cells: Array<[number, number]>, color: string): InkSpan[] =>
    cells.filter(([r]) => r === row).map(([, c]) => ({ col: c, color }))
  return [
    ...at(view.costume, INKS.costume),
    ...at(view.bells, INKS.bells),
    ...at(view.barnacles, INKS.barnacles),
    ...(meteredEyes ? at(view.eyes, 'warning') : []),
  ].sort((a, b) => a.col - b.col)
}

/**
 * A sprite row with its inked cells as spans of their own colour; the rest of the row
 * keeps the creature's own colour. A column named twice is inked once, by the first span.
 */
function inkSpans(t: any, row: string, inks: InkSpan[]): any {
  if (inks.length === 0) return row
  const { Text } = t
  const chars = Array.from(row)
  const out: any[] = []
  let from = 0
  for (const { col, color } of inks) {
    if (col < from || col >= chars.length) continue
    if (col > from) out.push(chars.slice(from, col).join(''))
    out.push(
      <Text key={`i${col}`} color={color}>
        {chars[col] ?? ''}
      </Text>,
    )
    from = col + 1
  }
  if (from < chars.length) out.push(chars.slice(from).join(''))
  return out
}

/**
 * The band: the bubble above, the one line beneath it on the left and the creature at
 * the right edge facing it, bottom-aligned so it sits low over the prompt. The bubble
 * voices, in order: a held write, a note from beneath, the companion's speech.
 */
export function bandTree(
  t: any,
  bodyColumns: number,
  view: View,
  below: unknown,
  eyeRow: number,
  ticket: Ticket | null,
  footer: QueueFooter = NO_FOOTER,
): any {
  const { Box, Text } = t
  const ink = view.safelight ? SAFELIGHT : undefined
  const parts = splitBeneath(below)
  const own = view.bubble
  const voice = view.safelight || parts.note === null ? own : null
  const speaking = voice !== null || parts.note !== null
  // The room left of the creature and its tail column.
  const room = Math.max(BUBBLE_FRAME + 1, bodyColumns - SPRITE_WIDTH[view.size] - 1)
  const width = bubbleWidth(room, voice, footerText(footer.onDismiss !== null, footer.n, footer.m))
  // The note from beneath keeps its own controls; the queue's count goes just after them.
  const count = countText(footer.n, footer.m)
  const note = fitWidth(parts.note, width - BUBBLE_FRAME)
  const counted = count === '' ? note : withCount(note, <Text dimColor>{` ${count}`}</Text>).tree
  // No width on the root: it holds the engine's own node (`parts.engine`), and an
  // engine node under a Box with a width is refused, blanking the whole band
  // (seen live seven times in S162 whenever no note stood beneath). The root takes
  // the band's width by itself; only the rows inside it are sized.
  // An estate-status ticket still standing beneath (that mod enabled beside 0.3.0) is
  // dropped: the witness draws the ticket itself, so it is never drawn twice.
  const line = ticketLine(t, ticket, view.status, ink)
  // A held write's safelight colours the whole creature and wins over this.
  const meteredEyes = ink === undefined && ticket?.kind === 'ok' && ticket.warnPush
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="flex-end">
        <Box flexDirection="column" width={room} flexShrink={0}>
          {speaking && (
            <Box
              alignSelf="flex-end"
              borderStyle="round"
              borderColor={ink}
              flexDirection="column"
              paddingX={1}
              width={width}
              overflow="hidden"
            >
              {voice !== null ? voiceTree(t, voice, width - BUBBLE_FRAME, footer, ink) : counted}
            </Box>
          )}
          {line}
        </Box>
        {tail(t, view.sprite.length, eyeRow, speaking, ink)}
        <Box flexDirection="column" flexShrink={0} width={SPRITE_WIDTH[view.size]}>
          {view.sprite.map((row, i) => (
            <Text key={`s${i}`} color={ink ?? view.colour} wrap="truncate-end">
              {ink === undefined ? inkSpans(t, row, rowInks(view, i, meteredEyes)) : row}
            </Text>
          ))}
        </Box>
      </Box>
      {parts.engine}
    </Box>
  )
}

/** Every ask with its state; an undone one can be dropped (never ticked: done means witnessed). */
export function paneTree(
  t: any,
  viewportRows: number,
  rows: PaneRow[],
  pale: Claim[],
  onDrop: (id: string) => unknown,
  onTackle: () => unknown,
): any {
  const { Box, Button, Text } = t
  const room = Math.max(3, viewportRows - 6)
  // A build is never tackled in a session: /close makes it a to-do (0.6.0).
  // Nor an ask the close triage made a to-do (0.8.0): it is on the board.
  const open = rows.filter(r => r.marker !== '[x]' && r.source !== 'build' && r.settled === undefined).length
  const heading = (row: PaneRow, prev: PaneRow | undefined, source: PaneRow['source']) =>
    row.source === source && prev?.source !== source
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            [x] witnessed  [~] claimed, no read-back yet  [ ] open
          </Text>
        </Box>
        {open > 0 && (
          <Box flexShrink={0} marginLeft={2}>
            <Button key="tackle" label={`tackle ${open}`} variant="primary" onPress={() => onTackle()} />
          </Box>
        )}
      </Box>
      {rows.length === 0 && <Text dimColor>No asks recorded this watch.</Text>}
      {rows.slice(0, room).map((row, i, shown) => [
        heading(row, shown[i - 1], 'carried') && (
          <Text key="carried-heading" dimColor>
            Carried from the last watch (not counted in asks n/m):
          </Text>
        ),
        heading(row, shown[i - 1], 'build') && (
          <Text key="build-heading" dimColor>
            Builds (multi-session; made to-dos at /close):
          </Text>
        ),
        <Box key={`r${row.id}`} flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              {row.source === 'build' ? '- ' : `${row.marker} `}
              <Text dimColor>{`${row.source === 'goal' ? '(goal) ' : ''}${row.settled === 'to-do' ? '(to-do) ' : ''}`}</Text>
              {row.text}
            </Text>
          </Box>
          {row.marker !== '[x]' && (
            <Box flexShrink={0} marginLeft={2}>
              <Button key={`drop-${row.id}`} label="drop" plain onPress={() => onDrop(row.id)} />
            </Box>
          )}
        </Box>,
      ])}
      {rows.length > room && <Text dimColor>{`${rows.length - room} more`}</Text>}
      {pale.length > 0 && <Text dimColor>{`Pale claims (said done, no read-back): ${pale.length}`}</Text>}
      {pale.slice(0, 5).map(c => (
        <Text key={`c${c.id}`} dimColor wrap="truncate-end">
          {`  ~ ${c.text}`}
        </Text>
      ))}
    </Box>
  )
}

/**
 * The Barnacles pane (1.1): what each barnacle records, a scrub beside each, and one for all.
 * A scrubbed barnacle leaves the shell at once and grows back only from new friction.
 */
export function barnaclesTree(
  t: any,
  barnacles: Barnacle[],
  onScrub: (key: string) => unknown,
  onScrubAll: () => unknown,
): any {
  const { Box, Button, Text } = t
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            Friction that recurs across sessions: the same problem on two or more days. Scrub one off, or all.
          </Text>
        </Box>
        {barnacles.length > 0 && (
          <Box flexShrink={0} marginLeft={2}>
            <Button key="scrub-all" label="scrub all" variant="primary" onPress={() => onScrubAll()} />
          </Box>
        )}
      </Box>
      {barnacles.length === 0 && <Text dimColor>No barnacles: nothing has recurred.</Text>}
      {barnacles.map(b => (
        <Box key={`b${b.key}`} flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              {'* '}
              {b.text}
              <Text dimColor>{`  (${b.key})`}</Text>
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Button key={`scrub-${b.key}`} label="scrub" plain onPress={() => onScrub(b.key)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
