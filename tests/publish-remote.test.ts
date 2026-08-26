import { describe, expect, it } from 'vitest';
import { SCRIPT, makePrivateRepo, head, run, runFail, attachBareRemote, seedPublic, stubGitFailing } from './helpers/publish-fixture';

const PKG = (v: string) => JSON.stringify({ name: 'x', version: v }, null, 2) + '\n';
const LOG = `# Changelog

## [0.8.0] — 2026-08-25

New.

## [0.7.0] — 2026-08-24

Old.
`;
const RU = LOG;

function scene(version = '0.8.0') {
  const repo = makePrivateRepo({
    '.publicignore': '.publicignore\n.publish.conf\nCLAUDE.md\n',
    'CLAUDE.md': 'private',
    'CHANGELOG.md': LOG,
    'CHANGELOG.ru.md': RU,
    'package.json': PKG(version),
    'src/app.ts': 'app'
  });
  const bare = attachBareRemote(repo);
  return { repo, bare };
}

describe('--remote-state', () => {
  it('is fresh when the previous tag points at the public tip', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const tip = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const out = run(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(out).toContain('state=fresh');
    expect(out).toContain(`parent=${tip}`);
  });

  it('accepts an annotated previous tag by peeling it', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const sha = run(repo, 'git', ['commit-tree', tree, '-m', 'release: v0.7.0']);
    run(repo, 'git', ['tag', '-a', 'v0.7.0', '-m', 'v0.7.0', sha]);
    run(repo, 'git', ['push', '--atomic', bare, `${sha}:refs/heads/main`, 'refs/tags/v0.7.0']);
    const out = run(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(out).toContain('state=fresh');
    expect(out).toContain(`parent=${sha}`);
  });

  it('is recovery when the target tag and main already point at our commit', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const prev = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    seedPublic(repo, bare, tree, 'release: v0.8.0', 'v0.8.0', prev);
    const out = run(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(out).toContain('state=recovery');
  });

  it('is a conflict when someone else moved the public branch', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const tagged = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const stray = run(repo, 'git', ['commit-tree', tree, '-m', 'merged on github', '-p', tagged]);
    run(repo, 'git', ['push', bare, `${stray}:refs/heads/main`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/moved|not the tip/i);
  });

  it('is a conflict when the previous tag is missing', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const sha = run(repo, 'git', ['commit-tree', tree, '-m', 'release: v0.7.0']);
    run(repo, 'git', ['push', bare, `${sha}:refs/heads/main`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/v0\.7\.0/);
  });

  it('is a conflict when the target tag points at a different commit', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const prev = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const other = run(repo, 'git', ['commit-tree', tree, '-m', 'something else', '-p', prev]);
    run(repo, 'git', ['push', '--atomic', bare, `${other}:refs/heads/main`, `${other}:refs/tags/v0.8.0`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/v0\.8\.0/);
  });

  it('refuses a recovery-shaped commit whose message is a near-miss of the exact release message', () => {
    // Correct tree, correct parent — only the message differs, and only by
    // a trailing word. A prefix/glob check on the subject would have let
    // this through; the fix requires an exact match on the full message.
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const prev = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const forged = run(repo, 'git', ['commit-tree', tree, '-m', 'release: v0.8.0 forged', '-p', prev]);
    run(repo, 'git', ['push', '--atomic', bare, `${forged}:refs/heads/main`, `${forged}:refs/tags/v0.8.0`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/v0\.8\.0/);
  });

  it('refuses a recovery-shaped commit built on the wrong parent', () => {
    // Correct tree, correct message — a hand-created v0.8.0 that is NOT a
    // child of v0.7.0. remote_state must not accept this as its own
    // recovery just because the tag sits on the public tip with a matching
    // tree and message; the parent has to be the peeled predecessor tag.
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const wrongParent = run(repo, 'git', ['commit-tree', tree, '-m', 'release: v0.8.0']);
    // --force here only because this fixture stands in for a hand-created
    // ref restore — a real one would necessarily also bypass the normal
    // fast-forward push the script itself always uses.
    run(repo, 'git', ['push', '--force', '--atomic', bare, `${wrongParent}:refs/heads/main`, `${wrongParent}:refs/tags/v0.8.0`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/parent|based on/i);
  });

  it('refuses a recovery-shaped commit that is a merge, even when its first parent is v$previous', () => {
    // Correct tree, correct message, first parent == v0.7.0 — everything
    // `git rev-parse "$target_sha^"` (first parent only) can see lines up.
    // But it's a two-parent merge commit, which commit-tree (what this
    // script itself always uses to build a release) can never produce, and
    // the public history is required to stay linear. A second parent alone
    // must be enough to refuse it, independent of what that second parent
    // is or matches.
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const prev = seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const otherParent = run(repo, 'git', ['commit-tree', tree, '-m', 'unrelated']);
    const merge = run(repo, 'git', [
      'commit-tree', tree, '-m', 'release: v0.8.0', '-p', prev, '-p', otherParent
    ]);
    run(repo, 'git', ['push', '--atomic', bare, `${merge}:refs/heads/main`, `${merge}:refs/tags/v0.8.0`]);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/merge|parent/i);
  });

  it('is a readable error, not a bare exit, when the public remote cannot be reached', () => {
    const repo = makePrivateRepo({
      '.publicignore': '.publicignore\n.publish.conf\nCLAUDE.md\n',
      'CLAUDE.md': 'private',
      'CHANGELOG.md': LOG,
      'CHANGELOG.ru.md': RU,
      'package.json': PKG('0.8.0'),
      'src/app.ts': 'app'
    });
    // No bare remote attached at all — `github` resolves to nothing git can
    // contact, standing in for a network blip, an auth failure, or a
    // misconfigured PUBLIC_REMOTE in .publish.conf.
    run(repo, 'git', ['remote', 'add', 'github', '/nonexistent/path/does-not-exist.git']);
    const r = runFail(repo, 'bash', [SCRIPT, '--remote-state', head(repo), '0.8.0']);
    expect(r.ok).toBe(false);
    expect(r.stderr).not.toBe('');
    expect(r.stderr).toMatch(/reach/i);
    expect(r.stderr).toMatch(/github/);
  });
});

describe('--new-paths', () => {
  it('lists nothing when the public tree gains no paths', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const out = run(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0']);
    expect(out).toContain('new=0');
  });

  it('lists a nested new path, not only top-level ones', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    run(repo, 'sh', ['-c', 'mkdir -p src/lib/server && printf x > src/lib/server/ops-secret.ts']);
    run(repo, 'git', ['add', '-A']);
    run(repo, 'git', ['commit', '-qm', 'add nested file']);
    const out = run(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0']);
    expect(out).toContain('src/lib/server/ops-secret.ts');
    expect(out).toContain('new=1');
    expect(out).toMatch(/confirm=[0-9a-f]{12}/);
  });

  it('changes the confirmation hash when the tree changes', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    run(repo, 'sh', ['-c', 'printf a > extra.txt']);
    run(repo, 'git', ['add', '-A']);
    run(repo, 'git', ['commit', '-qm', 'one']);
    const first = run(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0']);
    run(repo, 'sh', ['-c', 'printf b > extra.txt']);
    run(repo, 'git', ['commit', '-qam', 'two']);
    const second = run(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0']);
    const h = (s: string) => s.match(/confirm=([0-9a-f]+)/)![1];
    expect(h(second)).not.toBe(h(first));
  });

  // `set -e` does not apply inside the command-substitution subshell that
  // `tree=$(project_tree ...)` / `paths=$(new_paths ...)` run their callees
  // in under bash 3.2 (what this script targets, and what macOS ships): a
  // failing non-final statement in project_tree/new_paths does NOT stop the
  // function and does NOT make its own exit status reflect the failure —
  // only its LAST command's exit status does. Without an explicit `|| die`
  // on every command that can change the result, `git update-index
  // --force-remove` failing silently leaves the unfiltered index behind for
  // `git write-tree` (the function's last command) to commit as-is: the
  // full private tree, reported with a plausible `new=N` line instead of a
  // die. These prove the guards actually stop that, using a stubbed `git`
  // that fails one specific subcommand and forwards everything else
  // through to the real `git`.
  it('dies instead of emitting a tree when git update-index fails inside project_tree', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const stub = stubGitFailing('update-index');
    const r = runFail(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0'], {
      PATH: `${stub.bin}:${process.env.PATH}`
    });
    expect(r.ok).toBe(false);
    // Must not have printed a tree/new=/confirm= line — that would mean the
    // leak happened silently before dying, not that it was refused.
    expect(r.stdout).not.toMatch(/new=/);
    expect(r.stderr).toMatch(/update-index|project_tree/i);
  });

  it('dies instead of emitting a diff when git ls-tree fails inside new_paths', () => {
    const { repo, bare } = scene();
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    seedPublic(repo, bare, tree, 'release: v0.7.0', 'v0.7.0');
    const stub = stubGitFailing('ls-tree');
    const r = runFail(repo, 'bash', [SCRIPT, '--new-paths', head(repo), '0.8.0'], {
      PATH: `${stub.bin}:${process.env.PATH}`
    });
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toMatch(/new=/);
    expect(r.stderr).toMatch(/ls-tree/i);
  });
});
