import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { SCRIPT, makePrivateRepo, head, run, runFail, runInPty, writeFile, attachBareRemote, attachPrivateRemote, seedPublic, stubGh } from './helpers/publish-fixture';

const PKG = (v: string) => JSON.stringify({ name: 'x', version: v }, null, 2) + '\n';
const LOG = '# Changelog\n\n## [0.8.0] — 2026-08-25\n\nNew things.\n\n## [0.7.0] — 2026-08-24\n\nOld.\n';

function scene() {
  const repo = makePrivateRepo({
    '.publicignore': '.publicignore\n.publish.conf\nCLAUDE.md\n',
    'CLAUDE.md': 'private',
    'CHANGELOG.md': LOG,
    'CHANGELOG.ru.md': LOG,
    'package.json': PKG('0.8.0'),
    'src/app.ts': 'app'
  });
  const bare = attachBareRemote(repo);
  // publish() runs preflight, which insists HEAD matches the private remote —
  // Gitea first, then GitHub. Without an origin the whole task cannot run.
  attachPrivateRemote(repo);
  const gh = stubGh();
  const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
  const prev = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
  const env = { PATH: `${gh.bin}:${process.env.PATH}`, PUBLISH_CONFIRM: 'auto' };
  return { repo, bare, gh, prev, env };
}

function remoteSha(repo: string, bare: string, ref: string) {
  const out = run(repo, 'git', ['ls-remote', bare, ref]);
  return out === '' ? '' : out.split(/\s+/)[0];
}

describe('publish', () => {
  it('pushes a commit and its tag, then creates the release', () => {
    const { repo, bare, gh, prev, env } = scene();
    run(repo, 'bash', [SCRIPT, '0.8.0'], env);

    const main = remoteSha(repo, bare, 'refs/heads/main');
    expect(main).not.toBe(prev);
    expect(run(repo, 'git', ['rev-parse', `${main}^`])).toBe(prev);
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).toBe(main);
    expect(readFileSync(gh.log, 'utf8')).toMatch(/release create v0\.8\.0/);
  });

  it('publishes the projected tree, without the private files', () => {
    const { repo, bare, env } = scene();
    run(repo, 'bash', [SCRIPT, '0.8.0'], env);
    const main = remoteSha(repo, bare, 'refs/heads/main');
    const listing = run(repo, 'git', ['ls-tree', '-r', '--name-only', main]);
    expect(listing).toContain('src/app.ts');
    expect(listing).not.toContain('CLAUDE.md');
    expect(listing).not.toContain('.publicignore');
  });

  it('is a no-op on a second run', () => {
    const { repo, bare, env } = scene();
    run(repo, 'bash', [SCRIPT, '0.8.0'], env);
    const first = remoteSha(repo, bare, 'refs/heads/main');
    run(repo, 'bash', [SCRIPT, '0.8.0'], env);
    expect(remoteSha(repo, bare, 'refs/heads/main')).toBe(first);
  });

  it('finishes a release whose branch and tag landed but whose gh call failed', () => {
    const { repo, bare, gh, env } = scene();
    // Every gh call fails, so the refs land and the release does not.
    const failing = { ...env, GH_STUB_FAIL: '1' };
    const failed = runFail(repo, 'bash', [SCRIPT, '0.8.0'], failing);
    expect(failed.ok).toBe(false);
    const landed = remoteSha(repo, bare, 'refs/heads/main');
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).toBe(landed);

    const second = runFail(repo, 'bash', [SCRIPT, '0.8.0'], env);
    expect(second.ok).toBe(true);
    expect(remoteSha(repo, bare, 'refs/heads/main')).toBe(landed);
    expect(readFileSync(gh.log, 'utf8')).toMatch(/release create v0\.8\.0/);
  });

  it('refuses to guess when gh release view fails operationally on a release that already exists', () => {
    const { repo, gh, env } = scene();
    // First run: refs land, `release view` says "release not found" (no
    // release yet), `release create` runs.
    run(repo, 'bash', [SCRIPT, '0.8.0'], env);
    expect(readFileSync(gh.log, 'utf8')).toMatch(/release create v0\.8\.0/);

    // Second run: git side is already a no-op (refs match), but `gh release
    // view` now fails with an operational error — not "release not found"
    // — even though the release does in fact still exist. The script must
    // not read "view failed" as "no release" and retry create; it must
    // refuse and say the state is unknown.
    const r = runFail(repo, 'bash', [SCRIPT, '0.8.0'], { ...env, GH_STUB_VIEW_FAIL: '1' });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/cannot tell|unknown/i);
    expect(r.stderr).not.toMatch(/already exists/i);

    const calls = readFileSync(gh.log, 'utf8').match(/release create v0\.8\.0/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it('--dry-run writes nothing', () => {
    const { repo, bare, gh, prev, env } = scene();
    const out = run(repo, 'bash', [SCRIPT, '--dry-run', '0.8.0'], env);
    expect(out).toMatch(/tree=[0-9a-f]{40}/);
    expect(out).toContain('New things.');
    expect(remoteSha(repo, bare, 'refs/heads/main')).toBe(prev);
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).toBe('');
    expect(existsSync(gh.log)).toBe(false);
  });
});

function sceneWithNewPath() {
  const repo = makePrivateRepo({
    '.publicignore': '.publicignore\n.publish.conf\nCLAUDE.md\n',
    'CLAUDE.md': 'private',
    'CHANGELOG.md': LOG,
    'CHANGELOG.ru.md': LOG,
    'package.json': PKG('0.7.0'),
    'src/app.ts': 'app'
  });
  const bare = attachBareRemote(repo);
  const baseTree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
  seedPublic(repo, bare, baseTree, 'release: v0.7.0', 'v0.7.0');

  // A second commit adds a genuinely new public path and bumps the manifest,
  // so `new_paths` reports a non-zero count and `confirm_new_paths` actually
  // has something to gate — the fixed `scene()` above always has new=0.
  writeFile(repo, 'src/lib/server/new-thing.ts', 'x');
  writeFile(repo, 'package.json', PKG('0.8.0'));
  run(repo, 'git', ['add', '-A']);
  run(repo, 'git', ['commit', '-qm', 'bump + new path']);

  attachPrivateRemote(repo);
  const gh = stubGh();
  const env = { PATH: `${gh.bin}:${process.env.PATH}` };
  return { repo, bare, gh, env };
}

describe('confirm_new_paths gate', () => {
  it('PUBLISH_CONFIRM=auto skips the gate non-interactively, but loudly', () => {
    const { repo, bare, env } = sceneWithNewPath();
    // `-c '... 2>&1'` merges stderr into the captured stdout so the warning,
    // printed on stderr, is visible to the assertion below.
    const combined = run(repo, 'bash', ['-c', `bash "${SCRIPT}" 0.8.0 2>&1`], {
      ...env,
      PUBLISH_CONFIRM: 'auto'
    });
    expect(combined).toMatch(/WARNING/);
    expect(combined).toMatch(/PUBLISH_CONFIRM=auto/);
    expect(combined).toMatch(/1 new public path/);
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).not.toBe('');
  });

  it('dies with a readable message when non-interactive and the bypass is unset', () => {
    const { repo, bare, env } = sceneWithNewPath();
    const before = remoteSha(repo, bare, 'refs/heads/main');
    const r = runFail(repo, 'bash', [SCRIPT, '0.8.0'], env);
    expect(r.ok).toBe(false);
    expect(r.stderr).not.toBe('');
    expect(r.stderr).toMatch(/stdin is not a terminal/i);
    expect(r.stderr).toMatch(/PUBLISH_CONFIRM/);
    // Died before ever committing or pushing — nothing landed.
    expect(remoteSha(repo, bare, 'refs/heads/main')).toBe(before);
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).toBe('');
  });

  // The gate used to ask for a hash it never showed. Every other test here
  // only ever drives the PUBLISH_CONFIRM=auto bypass — this one actually
  // types the printed hash back at the interactive prompt, over a real pty
  // (see runInPty), and checks the list and the hash were both on screen
  // before it was asked for.
  it('accepts the printed confirmation hash typed at the prompt', () => {
    const { repo, bare, gh, env } = sceneWithNewPath();
    const listing = run(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0']);
    const hash = listing.match(/confirm=([0-9a-f]+)/)?.[1];
    expect(hash).toBeTruthy();

    const { code, output } = runInPty(repo, 'bash', [SCRIPT, '0.8.0'], `${hash}\n`, env);
    expect(code).toBe(0);
    expect(output).toContain('src/lib/server/new-thing.ts');
    expect(output).toContain(`confirm=${hash}`);
    expect(output).toMatch(/Type the confirmation hash/);
    expect(remoteSha(repo, bare, 'refs/tags/v0.8.0')).not.toBe('');
    expect(readFileSync(gh.log, 'utf8')).toMatch(/release create v0\.8\.0/);
  });
});

describe('version format validation', () => {
  it('rejects a version that only looks like x.y.z as a glob, in both modes', () => {
    const { repo, env } = scene();
    // `[0-9]*.[0-9]*.[0-9]*` as a case glob would accept this: `.` matches
    // any character there, not a literal dot.
    const main = runFail(repo, 'bash', [SCRIPT, '1a2b3'], env);
    expect(main.ok).toBe(false);
    expect(main.stderr).toMatch(/x\.y\.z/);

    const dry = runFail(repo, 'bash', [SCRIPT, '--dry-run', '1a2b3'], env);
    expect(dry.ok).toBe(false);
    expect(dry.stderr).toMatch(/x\.y\.z/);
  });
});
