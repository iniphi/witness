// The Jewels pane (/jewels, 1.6): every unsettled hook and skill candidate of this project in full,
// with take and dismiss under each, and calibrate all above (1.8). Takes the surface's element
// table (`$.ui.resolve(e)`), never `$` itself.

import type { Candidate } from '../types'
import { INKS } from './body'
import { queuedLine } from './charter'
import { EMPTY_JEWELS, jewelBody, jewelHeading, settledLine } from './jewels'
import { GEM } from './sprites'

/** What the pane does: take and dismiss one, or calibrate every one listed. */
export type JewelActions = {
  onTake: (c: Candidate) => unknown
  onDismiss: (c: Candidate) => unknown
  onCalibrateAll: () => unknown
}

export function jewelsTree(
  t: any,
  items: readonly Candidate[],
  settled: readonly Candidate[],
  now: number,
  columns: number,
  act: JewelActions,
  queued = 0,
): any {
  const { Box, Button, Text } = t
  const list = items
  const width = Math.max(20, columns - 4)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            Hooks and skills the witness thinks are worth building, newest first. Take one to have the session propose how.
          </Text>
        </Box>
        {list.length >= 2 && (
          <Box flexShrink={0} marginLeft={2}>
            <Button key="jewels-calibrate-all" label="calibrate all" variant="primary" onPress={() => act.onCalibrateAll()} />
          </Box>
        )}
      </Box>
      {list.length === 0 && <Text>{EMPTY_JEWELS}</Text>}
      {list.map(c => (
        <Box key={`j${c.key}`} flexDirection="column" marginTop={1}>
          <Text bold wrap="truncate-end">
            <Text color={c.kind === 'hook' ? INKS.hookGem : INKS.skillGem}>{GEM}</Text>
            {jewelHeading(c).slice(GEM.length)}
          </Text>
          {jewelBody(c, now, width).map((line, i) => (
            <Text key={`l${c.key}-${i}`} dimColor={i > 0 && line.startsWith('Seen ')}>{`  ${line}`}</Text>
          ))}
          <Box flexDirection="row" marginLeft={2}>
            <Button key={`take-${c.key}`} label="take" plain onPress={() => act.onTake(c)} />
            <Box marginLeft={1}>
              <Button key={`dismiss-${c.key}`} label="dismiss" plain onPress={() => act.onDismiss(c)} />
            </Box>
          </Box>
        </Box>
      ))}
      {queued > 0 && (
        <Box marginTop={1}>
          <Text dimColor>{`${queuedLine(queued)}.`}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>{settledLine(settled)}</Text>
      </Box>
    </Box>
  )
}
