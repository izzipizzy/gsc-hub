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

export function isLoopbackHostname(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets and may keep a fully-qualified trailing dot.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;

  // ::ffff:127.0.0.1 and friends.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped ? mapped[1] : host);
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  return !!v4 && Number(v4[1]) === 127;
}

export function isExposedDeployment(env: ExposureEnv): boolean {
  const flag = (env.EXPOSED_MODE ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;

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
