// One colour per metric on every chart in the app (site chart, dashboard
// sparklines, query history). Mirrors the --series-* variables in app.css;
// SVG attributes need literal values, so the source of truth lives here too.
export const SERIES = {
  clicks: '#2962ff',
  impr: '#9aa3b2',
  /** position is a level, not a direction: ink, never the up/down colours */
  pos: '#131722',
  ctr: '#6b7684',
  /** previous period, drawn dashed behind the current one */
  prev: '#c3c9d3'
} as const;

/** Google update bands: amber is reserved for updates, so every type stays in
 *  the amber family; the label names the type (Core, Spam, Discover). */
export const UPDATE_COLORS: Record<string, string> = {
  core: '#f5923c',
  spam: '#e0a324',
  discover: '#f0b35a',
  other: '#d9a066'
};

/** Site events (merges, migrations) are drawn in ink so they never read as a drop. */
export const EVENT_COLOR = '#131722';

export const AXIS = {
  grid: 'rgb(238 240 243)',
  line: 'rgb(228 231 236)',
  text: 'rgb(110 118 132)',
  ink: 'rgb(19 23 34)'
} as const;
