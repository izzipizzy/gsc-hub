import { describe, expect, it } from 'vitest';
import { SCRIPT, makePrivateRepo, head, run, runFail } from './helpers/publish-fixture';

const PKG = (v: string) => JSON.stringify({ name: 'x', version: v }, null, 2) + '\n';

const CHANGELOG = `# Changelog

## [0.8.0] — 2026-08-25

Headline for the new one.

### How to update

    git pull

## [0.7.0] — 2026-08-24

The previous one.
`;

const RU = `# Changelog

## [0.8.0] — 2026-08-25

Заголовок.

## [0.7.0] — 2026-08-24

Предыдущий.
`;

function repoWith(changelog: string, ru: string, version: string) {
  return makePrivateRepo({
    '.publicignore': '.publicignore\n.publish.conf\n',
    'CHANGELOG.md': changelog,
    'CHANGELOG.ru.md': ru,
    'package.json': PKG(version)
  });
}

describe('--changelog-info', () => {
  it('reports the target version, its predecessor and the section body', () => {
    const repo = repoWith(CHANGELOG, RU, '0.8.0');
    const out = run(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(out).toContain('version=0.8.0');
    expect(out).toContain('previous=0.7.0');
    const body = out.split('---body---\n')[1];
    expect(body).toContain('Headline for the new one.');
    expect(body).not.toContain('The previous one.');
    expect(body).not.toMatch(/^## \[0\.8\.0\]/m);
  });

  it('refuses when the manifest version differs from the argument', () => {
    const repo = repoWith(CHANGELOG, RU, '0.7.0');
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/manifest/i);
  });

  it('refuses when the target section is missing', () => {
    const repo = repoWith(CHANGELOG.replace('## [0.8.0] — 2026-08-25', '## [0.9.0] — 2026-08-25'), RU, '0.8.0');
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/no section/i);
  });

  it('refuses when the target section appears twice', () => {
    const doubled = CHANGELOG + '\n## [0.8.0] — 2026-08-26\n\nOops.\n';
    const repo = repoWith(doubled, RU, '0.8.0');
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/twice|more than one/i);
  });

  it('refuses when there is no predecessor section', () => {
    const only = '# Changelog\n\n## [0.8.0] — 2026-08-25\n\nFirst ever.\n';
    const repo = repoWith(only, '# Changelog\n\n## [0.8.0] — 2026-08-25\n\nПервый.\n', '0.8.0');
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/predecessor/i);
  });

  it('refuses when the translated changelog lacks the target version', () => {
    const repo = repoWith(CHANGELOG, RU.replace('## [0.8.0] — 2026-08-25', '## [0.7.1] — 2026-08-25'), '0.8.0');
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/CHANGELOG\.ru\.md/);
  });

  it('skips a non-version heading like [Unreleased] to find the real predecessor', () => {
    const withUnreleased = `# Changelog

## [0.8.0] — 2026-08-25

Headline for the new one.

## [Unreleased]

Nothing here yet.

## [0.7.0] — 2026-08-24

The previous one.
`;
    const repo = repoWith(withUnreleased, RU, '0.8.0');
    const out = run(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(out).toContain('previous=0.7.0');
  });

  it('refuses with a readable message when the commit has no version file', () => {
    const repo = makePrivateRepo({
      '.publicignore': '.publicignore\n.publish.conf\n',
      'CHANGELOG.md': CHANGELOG,
      'CHANGELOG.ru.md': RU
    });
    const r = runFail(repo, 'bash', [SCRIPT, '--changelog-info', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/commit has no package\.json/i);
  });
});
