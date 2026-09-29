import type { Config } from 'tailwindcss';

// Semantic tokens of the "trading desk" world. Values live in app.css as CSS
// variables; Tailwind only names them, so a class like `text-up` or `bg-acc-t`
// always means the same thing on every screen.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        pane: v('pane'),
        sunk: v('sunk'),
        line: { DEFAULT: v('line'), soft: v('line-soft') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        acc: { DEFAULT: v('acc'), deep: v('acc-deep'), t: v('acc-t') },
        up: { DEFAULT: v('up'), t: v('up-t') },
        dn: { DEFAULT: v('dn'), t: v('dn-t') },
        upd: { DEFAULT: v('upd'), t: v('upd-t'), ink: v('upd-ink') },
        warn: { DEFAULT: v('warn'), t: v('warn-t') }
      },
      fontFamily: {
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config;
