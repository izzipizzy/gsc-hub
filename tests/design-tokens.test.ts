// Every colour in the UI comes from the RGB-channel tokens in src/app.css, so
// the light, dark and system themes can swap them in one place. A literal hex,
// rgb() or Tailwind palette class in a page or component would stay put when
// the theme changes; this test keeps them out.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

const files = [
  ...walk('src/routes', '.svelte'),
  ...walk('src/lib/components', '.svelte'),
  'src/lib/chart-theme.ts'
];

const LITERALS: [string, RegExp][] = [
  ['hex colour', /(?<![&\w])#[0-9a-fA-F]{3,8}\b(?![-\w])/g],
  ['rgb()/hsl() with numbers', /\b(?:rgba?|hsla?)\(\s*\d/g],
  [
    'Tailwind palette class',
    /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|placeholder)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|yellow|emerald|rose|sky|indigo|orange|violet|purple|teal|cyan|lime|pink)-\d{2,3})\b/g
  ]
];

describe('design tokens', () => {
  it('pages, components and chart-theme use tokens, not literal colours', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // in-page anchors and Svelte blocks are not colours
        const scrubbed = line.replace(/href="[^"]*"/g, '').replace(/\{[#/:][a-z]+/g, '');
        for (const [kind, re] of LITERALS) {
          for (const m of scrubbed.matchAll(re)) hits.push(`${f}:${i + 1} ${kind}: ${m[0]}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('app.css defines colours only in the :root token block', () => {
    const css = readFileSync('src/app.css', 'utf8');
    const outside = css.replace(/:root\s*\{[^}]*\}/g, '');
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*\d/g) ?? []).toEqual([]);
    expect(outside.match(/\btext-white\b|\bbg-white\b|\bbg-black\b/g) ?? []).toEqual([]);
  });
});
