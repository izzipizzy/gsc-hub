import { describe, it, expect } from 'vitest';
import { isExposedDeployment } from '../src/lib/server/exposure';

// The two shortcuts this gates — the anonymous setup wizard and passing every
// request as local admin — are safe only when nothing but this machine can
// reach the app. So the question is not "is this origin routable from the
// internet" but "is it loopback", and anything else has to fail closed.
describe('isExposedDeployment', () => {
  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://127.1.2.3:3000',
    'http://[::1]:3000',
    'http://app.localhost:3000'
  ])('treats loopback origin %s as not exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(false);
  });

  it.each([
    'https://gsc.example.com',
    'http://gsc.example.com'
  ])('treats public origin %s as exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(true);
  });

  // A LAN address is not routable from the internet, which is not the same as
  // unreachable: a neighbour on the same Wi-Fi, VPN or Docker network gets in.
  it.each([
    'http://10.0.0.5:3000',
    'http://192.168.1.20:3000',
    'http://172.16.4.4:3000',
    'http://100.64.0.1:3000',
    'http://169.254.10.10:3000'
  ])('treats LAN address %s as exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(true);
  });

  // mDNS names resolve for anyone on the link, not just this host.
  it.each([
    'https://gsc.local',
    'https://gsc.orb.local',
    'http://box.internal'
  ])('treats link-local name %s as exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(true);
  });

  it('falls back to AUTH_URL when ORIGIN is unset', () => {
    expect(isExposedDeployment({ AUTH_URL: 'http://localhost:5173' })).toBe(false);
    expect(isExposedDeployment({ AUTH_URL: 'https://gsc.example.com' })).toBe(true);
  });

  // A tunnel publishes the container without changing the URL the backend sees,
  // so "no origin configured" cannot be read as "nobody can reach this".
  it('treats an unconfigured origin as exposed', () => {
    expect(isExposedDeployment({})).toBe(true);
  });

  it.each([
    ['an unparseable origin', 'not a url'],
    ['an origin with no host', 'file:///srv/app'],
    ['a trailing-dot host', 'https://gsc.example.com.']
  ])('fails safe on %s', (_label, ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(true);
  });

  it('lets EXPOSED_MODE=1 force exposed even on loopback', () => {
    expect(isExposedDeployment({ ORIGIN: 'http://localhost:5173', EXPOSED_MODE: '1' })).toBe(true);
  });

  it('lets EXPOSED_MODE=0 opt out for a deliberately trusted network', () => {
    expect(isExposedDeployment({ ORIGIN: 'https://gsc.local', EXPOSED_MODE: '0' })).toBe(false);
    expect(isExposedDeployment({ EXPOSED_MODE: '0' })).toBe(false);
  });

  it('ignores a blank ORIGIN and reads AUTH_URL instead', () => {
    // Compose passes an unset variable through as an empty string.
    expect(isExposedDeployment({ ORIGIN: '', AUTH_URL: 'http://localhost:5173' })).toBe(false);
    expect(isExposedDeployment({ ORIGIN: '   ', AUTH_URL: 'https://gsc.example.com' })).toBe(true);
  });
});
