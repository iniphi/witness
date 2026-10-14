// The Witness pane (/witness, 1.3.4): the companion (compact size since 1.3.9) with what it is watching now in
// the minor column, its own words in the major one, on the golden section; stacked when the
// pane is narrow. Takes the surface's element table (`$.ui.resolve(e)`), never `$`.

import type { AboutModel, AboutRow } from './about'
import { ABOUT_GAP, aboutColumns } from './about'
import { inkSpans, rowInks } from './render'
import { SAFELIGHT } from './view'
import type { View } from './view'

/** The readout's label column: the longest label (`barnacles`) and a space. */
const LABEL_WIDTH = 10
/** The command column: `/barnacles` and a space. */
const COMMAND_WIDTH = 12

function spriteRows(t: any, view: View, metered: boolean): any[] {
  const { Text } = t
  const ink = view.safelight ? SAFELIGHT : undefined
  return view.sprite.map((row, i) => (
    <Text key={`s${i}`} color={ink ?? view.colour} wrap="truncate-end">
      {ink === undefined ? inkSpans(t, row, rowInks(view, i, metered)) : row}
    </Text>
  ))
}

function readoutRows(t: any, rows: readonly AboutRow[]): any {
  const { Box, Text } = t
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>This watch</Text>
      {rows.map(r => (
        <Box key={`r-${r.label}`} flexDirection="row">
          <Box flexShrink={0} width={LABEL_WIDTH}>
            <Text dimColor>{r.label}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={r.tone}>{r.value}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function words(t: any, m: AboutModel, colour: string): any {
  const { Box, Text } = t
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color={colour}>
          {m.name}
        </Text>
        <Text dimColor>{`  ${m.title}`}</Text>
      </Text>
      {m.intro.map((p, i) => (
        <Box key={`p${i}`} marginTop={1}>
          <Text>{p}</Text>
        </Box>
      ))}
    </Box>
  )
}

function news(t: any, m: AboutModel): any {
  const { Box, Text } = t
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>New in 1.3</Text>
      {m.news.map(n => (
        <Text key={`n-${n.head}`}>
          <Text bold>{n.head}</Text>
          {`. ${n.text}`}
        </Text>
      ))}
    </Box>
  )
}

function commands(t: any, m: AboutModel): any {
  const { Box, Text } = t
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Commands</Text>
      {m.commands.map(c => (
        <Box key={`c-${c.name}`} flexDirection="row">
          <Box flexShrink={0} width={COMMAND_WIDTH}>
            <Text>{c.name}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor>{c.gloss}</Text>
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">
          {m.footer}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Side by side from ABOUT_SIDE_MIN body columns: the creature and the readout in the left
 * 38.2%, the words, what is new and the commands in the rest. Narrower, one column.
 */
export function aboutTree(t: any, bodyColumns: number, view: View, m: AboutModel, metered: boolean): any {
  const { Box } = t
  const cols = aboutColumns(bodyColumns)
  const colour = view.safelight ? SAFELIGHT : view.colour
  if (!cols.side) {
    return (
      <Box flexDirection="column">
        {spriteRows(t, view, metered)}
        {words(t, m, colour)}
        {readoutRows(t, m.readout)}
        {news(t, m)}
        {commands(t, m)}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" alignItems="flex-start">
      <Box key="witness-about-minor" flexDirection="column" flexShrink={0} width={cols.left}>
        {spriteRows(t, view, metered)}
        {readoutRows(t, m.readout)}
      </Box>
      <Box key="witness-about-major" flexDirection="column" flexShrink={0} width={cols.right} marginLeft={ABOUT_GAP}>
        {words(t, m, colour)}
        {news(t, m)}
        {commands(t, m)}
      </Box>
    </Box>
  )
}
