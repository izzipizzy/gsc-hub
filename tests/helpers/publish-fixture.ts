import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export const SCRIPT = join(process.cwd(), 'scripts', 'publish.sh');
const PTY_RUN = join(process.cwd(), 'tests', 'helpers', 'pty-run.py');

/** Run a command in `cwd`, returning trimmed stdout. Throws on non-zero exit. */
export function run(cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  }).trim();
}

/** Run and capture failure instead of throwing. */
export function runFail(cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const stdout = run(cwd, cmd, args, env);
    return { ok: true as const, stdout, stderr: '' };
  } catch (e: any) {
    return { ok: false as const, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

/**
 * Run a command with its stdin/stdout/stderr attached to a real
 * pseudo-terminal (via tests/helpers/pty-run.py), writing `input` to it.
 * Needed to drive publish.sh's confirmation prompt, which only fires when
 * `[ -t 0 ]` — a plain pipe never satisfies that, so execFileSync/spawnSync
 * alone can't reach it.
 */
export function runInPty(
  cwd: string,
  cmd: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = {}
): { code: number; output: string } {
  const result = spawnSync('python3', [PTY_RUN, cwd, cmd, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, output: result.stdout ?? '' };
}

export function writeFile(root: string, path: string, body: string, mode?: number) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  if (mode !== undefined) chmodSync(full, mode);
}

/** A private repo with .publish.conf, .publicignore and one commit. */
export function makePrivateRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pubtest-'));
  run(root, 'git', ['init', '-q', '-b', 'main', '.']);
  run(root, 'git', ['config', 'user.email', 't@t']);
  run(root, 'git', ['config', 'user.name', 't']);
  writeFile(root, '.publish.conf', [
    'PUBLIC_REMOTE=github',
    'PUBLIC_REPO=owner/repo',
    'PUBLIC_HOST=github.com',
    'PRIVATE_REMOTE=origin',
    'PRIVATE_BRANCH=main',
    'CHANGELOG_FILE=CHANGELOG.md',
    'CHANGELOG_ALT=CHANGELOG.ru.md',
    'VERSION_FILE=package.json',
    ''
  ].join('\n'));
  for (const [path, body] of Object.entries(files)) writeFile(root, path, body);
  run(root, 'git', ['add', '-A', '-f']);
  run(root, 'git', ['commit', '-qm', 'init']);
  return root;
}

export function head(root: string): string {
  return run(root, 'git', ['rev-parse', 'HEAD']);
}

export function treeFiles(root: string, tree: string): string[] {
  const out = run(root, 'git', ['ls-tree', '-r', '--name-only', tree]);
  return out === '' ? [] : out.split('\n');
}

/**
 * A bare repo standing in for GitHub, wired as the `github` remote.
 *
 * Nested under `owner/repo.git` — not just `repo.git` — so the path's last
 * two segments match the fixture's default `PUBLIC_REPO=owner/repo` (see
 * makePrivateRepo). preflight() checks the `github` remote's push URL
 * against PUBLIC_REPO; `git init --bare` creates the missing parent
 * directories on its own.
 */
export function attachBareRemote(repo: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'pubremote-')) + '/owner/repo.git';
  run(repo, 'git', ['init', '-q', '--bare', bare]);
  run(repo, 'git', ['remote', 'add', 'github', bare]);
  return bare;
}

/** A bare repo standing in for Gitea, wired as `origin`, with main pushed. */
export function attachPrivateRemote(repo: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'puborigin-')) + '/origin.git';
  run(repo, 'git', ['init', '-q', '--bare', bare]);
  run(repo, 'git', ['remote', 'add', 'origin', bare]);
  run(repo, 'git', ['push', '-q', 'origin', 'main']);
  return bare;
}

/** Publish `tree` as a child of `parent` (or a root commit) and tag it. */
export function seedPublic(repo: string, bare: string, tree: string, message: string, tag: string, parent?: string): string {
  const args = ['commit-tree', tree, '-m', message];
  if (parent) args.push('-p', parent);
  const sha = run(repo, 'git', args);
  run(repo, 'git', ['push', '--atomic', bare, `${sha}:refs/heads/main`, `${sha}:refs/tags/${tag}`]);
  return sha;
}

/** A fake `gh` on PATH that records its arguments into a log file. */
export function stubGh(): { bin: string; log: string } {
  const bin = mkdtempSync(join(tmpdir(), 'ghstub-'));
  const log = join(bin, 'calls.log');
  const marker = join(bin, 'released');
  // `release view` must fail until `release create` has run, otherwise the
  // script would think every release already exists and never create one.
  // Real `gh` says exactly "release not found" on stderr for that case —
  // publish.sh greps for that text, so the stub must say it too.
  // GH_STUB_FAIL makes every call fail identically (no message match at
  // all), which is how the partial-failure test gets refs pushed without a
  // release. GH_STUB_VIEW_FAIL makes only `release view` fail, with an
  // operational error rather than "release not found" — modeling a network
  // blip or expired auth on a release that in fact already exists.
  const body = [
    '#!/bin/sh',
    'if [ -n "$GH_STUB_FAIL" ]; then exit 1; fi',
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    'case "$1 $2" in',
    '  "release view")',
    '    if [ -n "$GH_STUB_VIEW_FAIL" ]; then',
    '      echo "HTTP 500: Internal Server Error" >&2',
    '      exit 1',
    '    fi',
    `    if [ -f ${JSON.stringify(marker)} ]; then exit 0; fi`,
    '    echo "release not found" >&2',
    '    exit 1',
    '    ;;',
    `  "release create") : > ${JSON.stringify(marker)} ;;`,
    'esac',
    ''
  ].join('\n');
  writeFileSync(join(bin, 'gh'), body);
  chmodSync(join(bin, 'gh'), 0o755);
  return { bin, log };
}

/**
 * A fake `git` on PATH that fails a single subcommand (matched on argv[1])
 * and forwards everything else to the real `git`. Used to prove that a
 * command whose failure could change project_tree's/new_paths' RESULT is
 * actually guarded with `|| die`, rather than silently ignored the way
 * `set -e` is inside a bash 3.2 command-substitution subshell.
 */
export function stubGitFailing(failSubcommand: string): { bin: string } {
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = mkdtempSync(join(tmpdir(), 'gitstub-'));
  const body = [
    '#!/bin/sh',
    `if [ "$1" = ${JSON.stringify(failSubcommand)} ]; then`,
    `  echo "stubbed failure: git $1" >&2`,
    '  exit 1',
    'fi',
    `exec ${JSON.stringify(realGit)} "$@"`,
    ''
  ].join('\n');
  writeFileSync(join(bin, 'git'), body);
  chmodSync(join(bin, 'git'), 0o755);
  return { bin };
}
