import { execFileSync } from 'node:child_process';
import pkg from '../../../package.json';

export type AppVersion = {
  /** Normalised release tag, e.g. `v0.6.8`. The only input to comparisons. */
  release: string;
  /** Short commit of the working tree on a dev host; null in a container. */
  commit: string | null;
};

/**
 * The container has no git and no `.git` (it is dockerignored), so the version
 * itself can only come from package.json — which the Dockerfile already copies
 * into the runtime stage. On a dev host git is right there and can name the
 * exact commit being served, which the manifest cannot.
 */
function gitCommit(): string | null {
  if (process.env.NODE_ENV !== 'development') return null;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

const release = `v${pkg.version}`;

export const appVersion: AppVersion = {
  release,
  commit: gitCommit()
};
