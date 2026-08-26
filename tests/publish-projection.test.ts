import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCRIPT, makePrivateRepo, head, run, treeFiles } from './helpers/publish-fixture';

const IGNORE = ['.publicignore', '.publish.conf', 'CLAUDE.md', 'ops/', 'scripts/*.py', ''].join('\n');

describe('--project-tree', () => {
  it('drops the excluded paths and keeps everything else', () => {
    const repo = makePrivateRepo({
      '.publicignore': IGNORE,
      'CLAUDE.md': 'private notes',
      'ops/deploy.sh': 'ops',
      'scripts/sync.py': 'py',
      'scripts/build.sh': 'sh',
      'src/app.ts': 'app',
      'README.md': 'readme'
    });
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, tree).sort()).toEqual([
      'README.md',
      'scripts/build.sh',
      'src/app.ts'
    ]);
  });

  it('does not consult .gitignore — a tracked ignored file still publishes', () => {
    const repo = makePrivateRepo({
      '.publicignore': IGNORE,
      '.gitignore': 'dist/\n',
      'dist/bundle.js': 'built',
      'README.md': 'readme'
    });
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, tree)).toContain('dist/bundle.js');
  });

  it('is deterministic — two runs produce the same tree', () => {
    const repo = makePrivateRepo({ '.publicignore': IGNORE, 'CLAUDE.md': 'x', 'README.md': 'y' });
    const first = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const second = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(second).toBe(first);
  });

  it('handles paths with spaces and special characters', () => {
    const repo = makePrivateRepo({
      '.publicignore': ['.publicignore', '.publish.conf', 'notes dir/', ''].join('\n'),
      'notes dir/a b.md': 'private',
      "src/it's fine.ts": 'public'
    });
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, tree)).toEqual(["src/it's fine.ts"]);
  });

  it('removes a file that was public before it was added to .publicignore', () => {
    const repo = makePrivateRepo({
      '.publicignore': ['.publicignore', '.publish.conf', ''].join('\n'),
      'ops/secret.md': 'was public',
      'README.md': 'readme'
    });
    const before = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, before)).toContain('ops/secret.md');

    run(repo, 'sh', ['-c', "printf 'ops/\\n' >> .publicignore"]);
    run(repo, 'git', ['commit', '-qam', 'hide ops']);
    const after = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, after)).not.toContain('ops/secret.md');
  });

  it('preserves the executable bit and symlinks', () => {
    const repo = makePrivateRepo({
      '.publicignore': ['.publicignore', '.publish.conf', ''].join('\n'),
      'bin/run.sh': '#!/bin/sh\n'
    });
    run(repo, 'chmod', ['+x', 'bin/run.sh']);
    run(repo, 'ln', ['-s', 'bin/run.sh', 'link']);
    run(repo, 'git', ['add', '-A']);
    run(repo, 'git', ['commit', '-qm', 'modes']);
    const tree = run(repo, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    const listing = run(repo, 'git', ['ls-tree', '-r', tree]);
    expect(listing).toMatch(/100755 blob \w+\tbin\/run\.sh/);
    expect(listing).toMatch(/120000 blob \w+\tlink/);
  });

  it('excludes a root-level file even when invoked from a subdirectory', () => {
    const repo = makePrivateRepo({
      '.publicignore': IGNORE,
      'CLAUDE.md': 'private notes',
      'src/app.ts': 'app',
      'README.md': 'readme'
    });
    const subdir = join(repo, 'src');
    const tree = run(subdir, 'bash', [SCRIPT, '--project-tree', head(repo)]);
    expect(treeFiles(repo, tree).sort()).toEqual(['README.md', 'src/app.ts']);
  });
});
