// Can anything other than this machine reach the app?
//
// Two shortcuts depend on the answer: the setup wizard is served anonymously
// until setup completes, and every request passes as local admin while login is
// off. Both hand over full admin to whoever can open a socket, so the bar is
// loopback — not "not routable from the internet". A LAN address, a VPN, a
// Docker network and an mDNS name are all reachable by other machines, so they
// count as exposed, and so does an origin we cannot read.
//
// EXPOSED_MODE overrides the answer in both directions. Set it to 0 to accept
// the risk on a network you trust — a home LAN, an OrbStack host — and to 1
// where the app is published by something the origin does not mention, such as
// a tunnel.

export interface ExposureEnv {
  ORIGIN?: string;
  AUTH_URL?: string;
  EXPOSED_MODE?: string;
}

// Expand an IPv6 hostname to its eight 16-bit groups, or null if it is not one.
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(':')) return null;
  const [head, tail] = host.split('::');
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').flatMap((g) => {
      // A trailing dotted-quad, as in ::ffff:127.0.0.1.
      const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(g);
      if (v4) {
        const b = v4.slice(1).map(Number);
        if (b.some((n) => n > 255)) return [NaN];
        return [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
      }
      return [/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN];
    });
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  if ([...left, ...right].some(Number.isNaN)) return null;
  if (tail === undefined) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...Array(fill).fill(0), ...right];
}

export function isLoopbackHostname(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets and may keep a fully-qualified trailing dot.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  if (v4) return Number(v4[1]) === 127;

  // Parsed rather than string-matched: new URL() rewrites ::ffff:127.0.0.1 as
  // ::ffff:7f00:1, so comparing spellings misses the form that actually arrives.
  const groups = ipv6Groups(host);
  if (!groups) return false;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  return isMapped && groups[6] >>> 8 === 127;
}

// null only when the operator has said nothing at all. A value we do not
// recognise is an attempt to say something, most likely "this is exposed" —
// guessing the other way turns a typo into an open instance.
function explicitMode(env: ExposureEnv): boolean | null {
  const flag = (env.EXPOSED_MODE ?? '').trim().toLowerCase();
  if (flag === '') return null;
  if (flag === '0' || flag === 'false') return false;
  return true;
}

function isExposedOrigin(env: ExposureEnv): boolean {
  // An unset compose variable arrives as an empty string, not as undefined, so
  // ?? would let a blank ORIGIN shadow a perfectly good AUTH_URL.
  const origin = [env.ORIGIN, env.AUTH_URL].map((v) => (v ?? '').trim()).find((v) => v !== '') ?? '';
  // Nothing configured says nothing about reachability: a tunnel publishes the
  // container without the backend ever learning a new URL. Fail closed and make
  // the operator say which it is.
  if (!origin) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return true;
  }
  if (!hostname) return true;
  return !isLoopbackHostname(hostname);
}

/** Config only. The guard wants isExposedRequest, which also sees the host. */
export function isExposedDeployment(env: ExposureEnv): boolean {
  return explicitMode(env) ?? isExposedOrigin(env);
}

// The configured origin cannot see a publisher the app was never told about — a
// tunnel, an OrbStack label, a bind on 0.0.0.0 — so the host the request
// actually arrived on is a second signal, and either one is enough. An explicit
// EXPOSED_MODE outranks both: that is the whole point of setting it, and
// silencing only one of them is how "trusted network" stopped working.
export function isExposedRequest(env: ExposureEnv, requestHostname: string): boolean {
  const explicit = explicitMode(env);
  if (explicit !== null) return explicit;
  return isExposedOrigin(env) || !isLoopbackHostname(requestHostname);
}
