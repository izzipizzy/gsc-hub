#!/usr/bin/env node
// Bump the version the app reports about itself. The footer reads it out of
// package.json, and the manifest had already drifted once — 0.6.0 against tag
// v0.6.8 — which made the app misreport what was running.
//
// This deliberately does NOT tag. Version tags in this repo live on the public
// squashed release lineage (release/vX.Y.Z-public), not on private main: the
// private repo carries no vX.Y.Z tags at all. The tag is created on the public
// release commit at publish time. Pushes nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: pnpm release <x.y.z>');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Tracked changes only: stray untracked files (tool caches, a local data/
// directory) have nothing to do with what gets released.
if (git('status', '--porcelain', '--untracked-files=no') !== '') {
  console.error('Working tree has uncommitted changes — commit or stash first.');
  process.exit(1);
}

const tag = `v${version}`;
if (git('tag', '--list', tag) !== '') {
  console.error(`Tag ${tag} already exists — is this version already published?`);
  process.exit(1);
}

const pkgPath = new URL('../package.json', import.meta.url);
const raw = readFileSync(pkgPath, 'utf8');
// Textual replace, not JSON.stringify: the manifest is tab-indented and a
// re-serialised file would show up as a whole-file diff on every release.
const bumped = raw.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
if (bumped === raw) {
  console.error('Could not find a "version" field in package.json.');
  process.exit(1);
}
writeFileSync(pkgPath, bumped);

git('add', 'package.json');
git('commit', '-m', `chore(release): ${tag}`);

console.log(`Manifest bumped to ${version} and committed. Next:

  1. git push origin main
  2. Publish ${tag} publicly: branch release/${tag}-public off the previous
     public branch, squash the current tree into one "release: ${tag} — …"
     commit, tag ${tag} there, push it to the github remote and create the
     release with the ${tag} section of CHANGELOG.md as its notes.

The update banner only fires for other people once that GitHub release exists.`);
