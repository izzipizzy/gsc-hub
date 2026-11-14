// One colour per metric on every chart in the app (site chart, dashboard
// sparklines, query history). Colours live as RGB-channel variables in
// app.css so they follow the theme; SVG presentation attributes accept var().

/** `rgb(var(--name))`, or with alpha `rgb(var(--name) / a)`, for a token in app.css. */
export function tok(name: string, alpha?: number): string {
  return alpha === undefined ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${alpha})`;
}

export const SERIES = {
  clicks: tok('series-clicks'),
  impr: tok('series-impr'),
  /** position is a level, not a direction: ink, never the up/down colours */
  pos: tok('series-pos'),
  ctr: tok('series-ctr'),
  /** previous period, drawn dashed behind the current one */
  prev: tok('series-prev')
} as const;

/** Google update bands: amber is reserved for updates, so every type stays in
 *  the amber family; the label names the type (Core, Spam, Discover). */
export const UPDATE_TOKENS: Record<string, string> = {
  core: 'upd-core',
  spam: 'upd-spam',
  discover: 'upd-discover',
  other: 'upd-other'
};

export const UPDATE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(UPDATE_TOKENS).map(([type, name]) => [type, tok(name)])
);

/** Update band colour with alpha; unknown types fall back to `other`. */
export function updateColor(type: string, alpha?: number): string {
  return tok(UPDATE_TOKENS[type] ?? UPDATE_TOKENS.other, alpha);
}

/** Site events (merges, migrations) are drawn in ink so they never read as a drop. */
export const EVENT_COLOR = tok('event-merge');

export const AXIS = {
  grid: tok('line-soft'),
  line: tok('line'),
  text: tok('ink-3'),
  /** crosshair and the volume bar under the pointer */
  hover: tok('ink-2'),
  ink: tok('ink'),
  /** text on the filled clicks (acc) tag */
  onAcc: tok('on-acc'),
  /** text on ink tags and marker outlines: the chart surface colour, so it inverts with the theme */
  onInk: tok('pane'),
  /** label plates behind event names */
  plate: tok('pane')
} as const;

/** Position an event on an index-spaced daily series, interpolating calendar gaps.
 * Dates outside the displayed window have no marker. A single day is centered. */
export function eventPosition(dates: readonly string[], date: string): number | null {
  if (!dates.length || date < dates[0] || date > dates[dates.length - 1]) return null;
  if (dates.length === 1) return 0.5;
  const right = dates.findIndex((d) => d >= date);
  if (dates[right] === date) return right / (dates.length - 1);
  const left = right - 1;
  const fraction = (Date.parse(date) - Date.parse(dates[left])) /
    (Date.parse(dates[right]) - Date.parse(dates[left]));
  return (left + fraction) / (dates.length - 1);
}
