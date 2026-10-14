// /witness (1.3.4): the companion says what it is, what it is watching now and what 1.3
// brought. Pure: plain values in, words out. The pane's tree is aboutpane.tsx.

import type { Activity, Ask, Barnacle, Body, Costume, Hold, Ledger } from '../types'
import { counts } from './asks'
import { paleCount } from './witness'

export const ABOUT_TITLE = 'Witness'
/** The golden section (House Style): the creature and its readout take the minor part. */
export const ABOUT_SHARE = 0.382
/** The narrowest pane body that seats the creature beside its words; narrower, they stack. */
export const ABOUT_SIDE_MIN = 80
/** The readout needs room for its label column and a short value; the creature (14 columns) sits in the same column. */
const ABOUT_LEFT_MIN = 30
export const ABOUT_GAP = 3
export const REPO = 'github.com/iniphi/witness'

const NAME: Readonly<Record<Body, string>> = { phi: 'Naut', phial: 'Phial' }
const KIND: Readonly<Record<Body, string>> = { phi: 'a nautilus', phial: 'a round-bottom flask' }
/** What deepens as the proofs come in. */
const HIDE: Readonly<Record<Body, string>> = { phi: 'shell', phial: 'glass' }

export type AboutRow = { label: string; value: string; tone?: 'warning' | 'error' }
export type NewsItem = { head: string; text: string }
export type CommandRow = { name: string; gloss: string }

export type AboutModel = {
  name: string
  /** `witness 1.3.4`, or `witness` when the manifest could not be read. */
  title: string
  intro: string[]
  readout: AboutRow[]
  news: NewsItem[]
  commands: CommandRow[]
  footer: string
}

export type AboutInput = {
  body: Body
  version: string | null
  asks: Ask[]
  ledger: Ledger
  activity: Activity
  barnacles: Barnacle[]
  hold: Hold | null
  /** Other live pods; null when the sonar is off. */
  pods: number | null
  costume: Costume
  /** A push from this repository would start a metered build: the eye is amber. */
  metered: boolean
}

/** The manifest's version, or null for anything that is not a plain x.y.z. */
export function versionOf(manifest: unknown): string | null {
  if (typeof manifest !== 'string') return null
  try {
    const v = (JSON.parse(manifest) as { version?: unknown }).version
    return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null
  } catch {
    return null
  }
}

export function titleOf(version: string | null): string {
  return version === null ? 'witness' : `witness ${version}`
}

/** What the companion says of itself, a paragraph a line. */
export function intro(body: Body): string[] {
  return [
    `I am ${NAME[body]}, the witness: ${KIND[body]} who sits by your prompt and keeps the ledger of what you asked for.`,
    'I count a thing done only when I have seen it: a read-back of what was written, or your own words. ' +
      `Saying it is done is not seeing it. A claim stays pale until its proof lands, and my ${HIDE[body]} deepens as the proofs come in.`,
    'A bare UPDATE or DELETE waits for your answer. I never wave a call past another guard.',
  ]
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Active time as `1h 40m`, or `25m` under the hour. */
export function workText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** This watch, as the companion reads it now; a row it has nothing to say on is left out. */
export function readout(v: AboutInput): AboutRow[] {
  const c = counts(v.asks)
  const claims = v.ledger.claims.length
  const pale = paleCount(v.ledger)
  const rows: AboutRow[] = [
    {
      label: 'asks',
      value: c.total === 0 ? 'none recorded yet' : `${c.done} of ${c.total} witnessed${c.pale > 0 ? `, ${c.pale} pale` : ''}`,
    },
  ]
  if (c.carried > 0) rows.push({ label: 'carried', value: `${c.carried} from the last watch` })
  if (c.builds > 0) rows.push({ label: 'builds', value: `${c.builds} for the to-do list` })
  rows.push({ label: 'claims', value: claims === 0 ? 'none made yet' : `${claims - pale} of ${claims} read back` })
  rows.push({ label: 'bells', value: `${workText(v.activity.activeMs)} of work` })
  rows.push({
    label: 'barnacles',
    value: v.barnacles.length === 0 ? 'none: nothing recurs' : `${plural(v.barnacles.length, 'barnacle')} on the shell`,
  })
  rows.push(v.hold === null ? { label: 'writes', value: 'nothing held' } : { label: 'writes', value: 'one held for your answer', tone: 'error' })
  rows.push({
    label: 'pods',
    value: v.pods === null ? 'sonar off' : v.pods === 0 ? 'no other live session' : `${plural(v.pods, 'other live session')}`,
  })
  if (v.metered) rows.push({ label: 'push', value: 'metered: my eye is amber', tone: 'warning' })
  if (v.costume !== 'none') rows.push({ label: 'wearing', value: `the ${v.costume}, on the band` })
  return rows
}

/** What 1.3 brought, from the CHANGELOG, in the companion's words. */
export const NEWS: readonly NewsItem[] = [
  {
    head: 'A guest beside me',
    text: 'Another mod can draw in my band. From 104 columns it takes the left 38.2%; narrower, it stands above me, and while a devil\'s advocate stands there I wear its horns.',
  },
  {
    head: 'Hands that wait',
    text: 'A /hand from another session waits in your prompt box for Enter unless you set typedHands to start. A hand I cannot read never reaches the model.',
  },
  {
    head: 'A clean /clear',
    text: 'After /clear my heartbeat follows the new session at once, so no pod lists one that has ended.',
  },
  { head: '/witness', text: 'This pane: what I am, and what I am watching now.' },
]

/** The commands, the sonar's two only where the sonar is on. */
export function commandRows(sonar: boolean): CommandRow[] {
  const all: Array<CommandRow & { sonar?: true }> = [
    { name: '/undone', gloss: 'every ask: witnessed, pale or open' },
    { name: '/wrap', gloss: 'end the watch and print it into the session log' },
    { name: '/tackle', gloss: 'a run over the undone asks, for you to read and send' },
    { name: '/barnacles', gloss: 'what recurs, to treat or wash off' },
    { name: '/jewels', gloss: 'proposed hooks and skills, to take or dismiss' },
    { name: '/wear', gloss: 'razor, compass, horns, devil or none' },
    { name: '/pods', gloss: 'the other live sessions on this machine', sonar: true },
    { name: '/hand', gloss: 'hand work to one of them', sonar: true },
    { name: '/witness', gloss: 'this' },
  ]
  return all.filter(c => sonar || c.sonar !== true).map(({ name, gloss }) => ({ name, gloss }))
}

export function aboutModel(v: AboutInput): AboutModel {
  const title = titleOf(v.version)
  return {
    name: NAME[v.body],
    title,
    intro: intro(v.body),
    readout: readout(v),
    news: [...NEWS],
    commands: commandRows(v.pods !== null),
    footer: `${title} · MIT · ${REPO}`,
  }
}

/** The command's own line in the transcript. Unplaced (no surface draws the pane), the whole of it as text. */
export function aboutReply(m: AboutModel, placed: boolean): string {
  if (placed) return `${m.name}: I count a thing done only when I have seen it. ${m.title} - the rest is in the Witness pane.`
  return aboutText(m)
}

/** Everything the pane says, as plain text. */
export function aboutText(m: AboutModel): string {
  const width = Math.max(...m.readout.map(r => r.label.length)) + 2
  return [
    `${m.name} - ${m.title}`,
    '',
    ...m.intro,
    '',
    'This watch:',
    ...m.readout.map(r => `  ${r.label.padEnd(width)}${r.value}`),
    '',
    'New in 1.3:',
    ...m.news.map(n => `  ${n.head}. ${n.text}`),
    '',
    m.footer,
  ].join('\n')
}

/** Side by side on the golden section from ABOUT_SIDE_MIN body columns; stacked below that. */
export function aboutColumns(bodyColumns: number): { side: boolean; left: number; right: number } {
  const cols = Math.max(0, Math.trunc(bodyColumns))
  if (cols < ABOUT_SIDE_MIN) return { side: false, left: cols, right: cols }
  const left = Math.max(ABOUT_LEFT_MIN, Math.round(cols * ABOUT_SHARE))
  return { side: true, left, right: cols - left - ABOUT_GAP }
}
