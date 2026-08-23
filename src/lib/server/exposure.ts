// Is this instance reachable from outside the machine it runs on?
//
// A loopback deployment gets two conveniences that are only safe there: the
// setup wizard is served anonymously until setup completes, and every request
// passes as local admin while login is off. On a public origin either one is an
// open door, so the guard needs to know which kind of deployment this is.
//
// Derived from the configured origin, because that is what the operator already
// sets when putting the app behind a proxy. EXPOSED_MODE overrides it either
// way for deployments the heuristic cannot see (a tunnel, or a LAN the operator
// does not trust).

export interface ExposureEnv {
  ORIGIN?: string;
  AUTH_URL?: string;
  EXPOSED_MODE?: string;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  // mDNS names resolve on the link only — OrbStack's gsc.local, gsc.orb.local.
  if (host === 'local' || host.endsWith('.local')) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isExposedDeployment(env: ExposureEnv): boolean {
  const flag = (env.EXPOSED_MODE ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;

  const origin = (env.ORIGIN ?? env.AUTH_URL ?? '').trim();
  // No origin configured at all is the loopback default this app ships with.
  if (!origin) return false;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    // An origin we cannot parse is an origin we cannot vouch for.
    return true;
  }
  if (!hostname) return true;
  return !isLocalHostname(hostname);
}
