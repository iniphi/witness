// The Pods pane (the sonar, 1.2): every other live witness session, what it is on, the files
// it and this pod both wrote, and hands waiting for an empty prompt box. Takes the surface's
// element table (`$.ui.resolve(e)`), never `$`: the engine follows `$` only in the hooks module.

import type { Hand, PodState } from '../types'

/** One pod as the pane lists it (sonar.ts `podRows`). */
export type PodRow = {
  index: number
  label: string
  state: PodState
  age: string
  asks: string
  goals: string[]
  overlaps: string[]
}

/** Most pods the pane lists. */
export const PANE_PODS = 12

export function podsTree(
  t: any,
  rows: readonly PodRow[],
  waiting: readonly Hand[],
  onFill: (id: string) => unknown,
): any {
  const { Box, Button, Text } = t
  const shown = rows.slice(0, PANE_PODS)
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {'Other live pods. Hand one work with /hand <number|name> <text>: typed by you, an idle pod starts it.'}
      </Text>
      {rows.length === 0 && <Text dimColor>No other pod is live.</Text>}
      {shown.map(row => (
        <Box key={`pod${row.index}`} flexDirection="column">
          <Text wrap="truncate-end">
            {`${row.index}. `}
            <Text bold>{row.label}</Text>
            <Text dimColor>{`  ${row.state}, beat ${row.age} ago, asks ${row.asks}`}</Text>
          </Text>
          {row.goals.map((g, i) => (
            <Text key={`g${row.index}-${i}`} dimColor wrap="truncate-end">
              {`   - ${g}`}
            </Text>
          ))}
          {row.overlaps.map((p, i) => (
            <Text key={`o${row.index}-${i}`} color="warning" wrap="truncate-end">
              {`   ! ${p}`}
            </Text>
          ))}
        </Box>
      ))}
      {rows.length > shown.length && <Text dimColor>{`${rows.length - shown.length} more`}</Text>}
      {waiting.length > 0 && <Text dimColor>Hands waiting for an empty prompt box:</Text>}
      {waiting.map(h => (
        <Box key={`h${h.id}`} flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{`from ${h.fromName}: ${h.text.split('\n')[0] ?? ''}`}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Button key={`fill-${h.id}`} label="to the box" plain onPress={() => onFill(h.id)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
