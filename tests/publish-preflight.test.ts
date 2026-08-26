import { describe, expect, it } from 'vitest';
import { SCRIPT, makePrivateRepo, run, runFail, writeFile, attachBareRemote, attachPrivateRemote } from './helpers/publish-fixture';

const PKG = (v: string) => JSON.stringify({ name: 'x', version: v }, null, 2) + '\n';
const LOG = '# Changelog\n\n## [0.8.0] — 2026-08-25\n\nNew.\n\n## [0.7.0] — 2026-08-24\n\nOld.\n';

/** A private repo that also has an `origin` bare remote with main pushed. */
function scene() {
  const repo = makePrivateRepo({
    '.publicignore': '.publicignore\n.publish.conf\n',
    'CHANGELOG.md': LOG,
    'CHANGELOG.ru.md': LOG,
    'package.json': PKG('0.8.0'),
    'src/app.ts': 'app'
  });
  attachBareRemote(repo);
  attachPrivateRemote(repo);
  return repo;
}

describe('--preflight', () => {
  it('passes on a clean private main that matches origin', () => {
    const repo = scene();
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(true);
  });

  it('refuses when the working tree has uncommitted tracked changes', () => {
    const repo = scene();
    writeFile(repo, 'src/app.ts', 'changed');
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/uncommitted/i);
  });

  it('refuses on a branch other than the private main', () => {
    const repo = scene();
    run(repo, 'git', ['checkout', '-qb', 'feature']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/branch/i);
  });

  it('refuses when HEAD is ahead of the private remote', () => {
    const repo = scene();
    writeFile(repo, 'src/app.ts', 'changed');
    run(repo, 'git', ['commit', '-qam', 'local only']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/push .* first|origin/i);
  });

  it('refuses when the tree carries .gitattributes', () => {
    const repo = scene();
    writeFile(repo, '.gitattributes', '* text=auto\n');
    run(repo, 'git', ['add', '.gitattributes']);
    run(repo, 'git', ['commit', '-qm', 'attrs']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/gitattributes/i);
  });

  it('refuses when the tree carries a nested .gitattributes, not only a root one', () => {
    // git applies .gitattributes at any level. A file only at
    // assets/.gitattributes (e.g. carrying an LFS filter) must be refused
    // just like a root-level one — checking only "HEAD:.gitattributes"
    // would miss it and publish it (and the un-uploaded LFS pointer next
    // to it) silently.
    const repo = scene();
    writeFile(repo, 'assets/.gitattributes', '*.bin filter=lfs\n');
    run(repo, 'git', ['add', 'assets/.gitattributes']);
    run(repo, 'git', ['commit', '-qm', 'nested attrs']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/gitattributes/i);
  });

  it('refuses when the nested .gitattributes sits under a directory name that plain ls-tree C-quotes', () => {
    // Without `-z`, `git ls-tree` wraps a path containing a tab, newline or
    // other quoting-triggering byte in double quotes with backslash
    // escapes: "weird\tdir/.gitattributes" — a field that ends in a
    // literal `"`, not in ".gitattributes", so a check anchored on the
    // field's end would silently miss it. The fix walks the tree with `-z`
    // (no quoting at all) instead.
    const repo = scene();
    writeFile(repo, 'weird\tdir/.gitattributes', '*.bin filter=lfs\n');
    run(repo, 'git', ['add', '-A']);
    run(repo, 'git', ['commit', '-qm', 'quoted nested attrs']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/gitattributes/i);
  });

  it('does not false-positive on a filename that merely ends in .gitattributes', () => {
    const repo = scene();
    writeFile(repo, 'weird.gitattributes.txt', 'not actually a gitattributes file\n');
    run(repo, 'git', ['add', 'weird.gitattributes.txt']);
    run(repo, 'git', ['commit', '-qm', 'lookalike name']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(true);
  });

  it('refuses when the tree carries a submodule gitlink', () => {
    const repo = scene();
    const sub = makePrivateRepo({ 'a.txt': 'a' });
    run(repo, 'git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub']);
    run(repo, 'git', ['commit', '-qm', 'submodule']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/submodule|gitlink/i);
  });

  // `git ls-tree -r HEAD | grep -q '^160000 '` fails OPEN under `set -e -o
  // pipefail` once the listing is big enough that `git ls-tree` is still
  // writing when `grep -q` exits on its first match — the write gets
  // SIGPIPE, the pipeline's status becomes 141 (not grep's), and the `if`
  // sees a false pipeline. A handful of files never reproduces this: the
  // producer finishes writing (and the pipe holds it all) before grep even
  // has to look past its first match. Padding the tree with enough filler,
  // sorted after the gitlink so grep matches early and there is plenty left
  // to write, is what actually exercises the failure the fix closes.
  it('refuses on a submodule gitlink even in a tree too large to fit a pipe buffer', () => {
    const repo = scene();
    const sub = makePrivateRepo({ 'a.txt': 'a' });
    run(repo, 'git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub']);
    for (let i = 0; i < 4000; i++) {
      writeFile(repo, `zzz-filler/f${String(i).padStart(5, '0')}.txt`, 'x');
    }
    run(repo, 'git', ['add', '-A']);
    run(repo, 'git', ['commit', '-qm', 'submodule + filler']);
    run(repo, 'git', ['push', '-q', 'origin', 'main']);

    const listing = run(repo, 'git', ['ls-tree', '-r', 'HEAD']);
    expect(listing.length).toBeGreaterThan(200_000); // sanity: past any real pipe buffer

    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/submodule|gitlink/i);
  });

  // `git push` goes to whatever URL the `github` remote carries; `gh
  // release create` goes to PUBLIC_REPO from .publish.conf regardless. If
  // those disagree, the tree can land on one repo while the release is cut
  // on another.
  it('refuses when the public remote push URL does not match PUBLIC_REPO', () => {
    const repo = scene();
    run(repo, 'git', ['remote', 'set-url', '--push', 'github', 'git@github.com:someone-else/unrelated.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/PUBLIC_REPO|does not match/i);
  });

  it('accepts an https push URL for PUBLIC_REPO, .git suffix included', () => {
    const repo = scene();
    run(repo, 'git', ['remote', 'set-url', '--push', 'github', 'https://github.com/owner/repo.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(true);
  });

  it('accepts an ssh push URL for PUBLIC_REPO, .git suffix included', () => {
    const repo = scene();
    run(repo, 'git', ['remote', 'set-url', '--push', 'github', 'git@github.com:owner/repo.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(true);
  });

  // The path-suffix check alone proves nothing about where the push
  // actually goes: https://example.invalid/owner/repo.git ends in exactly
  // PUBLIC_REPO and would pass it. The host itself — from PUBLIC_HOST in
  // .publish.conf — has to be checked too.
  it('refuses an https push URL whose path matches PUBLIC_REPO but whose host is not PUBLIC_HOST', () => {
    const repo = scene();
    run(repo, 'git', ['remote', 'set-url', '--push', 'github', 'https://example.invalid/owner/repo.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/host|PUBLIC_HOST/i);
  });

  it('refuses an ssh push URL whose path matches PUBLIC_REPO but whose host is not PUBLIC_HOST', () => {
    const repo = scene();
    run(repo, 'git', ['remote', 'set-url', '--push', 'github', 'git@example.invalid:owner/repo.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--preflight', '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/host|PUBLIC_HOST/i);
  });
});
