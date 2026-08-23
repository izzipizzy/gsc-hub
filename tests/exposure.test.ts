import { describe, it, expect } from 'vitest';
import { isExposedDeployment } from '../src/lib/server/exposure';

describe('isExposedDeployment', () => {
  it('treats a public https origin as exposed', () => {
    expect(isExposedDeployment({ ORIGIN: 'https://gsc.example.com' })).toBe(true);
  });

  it('treats a public http origin as exposed too', () => {
    expect(isExposedDeployment({ ORIGIN: 'http://gsc.example.com' })).toBe(true);
  });

  it('falls back to AUTH_URL when ORIGIN is unset', () => {
    expect(isExposedDeployment({ AUTH_URL: 'https://gsc.example.com' })).toBe(true);
  });

  it('is not exposed with no origin configured at all', () => {
    expect(isExposedDeployment({})).toBe(false);
  });

  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://[::1]:3000'
  ])('treats loopback origin %s as not exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(false);
  });

  it.each([
    'https://gsc.local',
    'https://gsc.orb.local'
  ])('treats mDNS origin %s as not exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(false);
  });

  it.each([
    'http://10.0.0.5:3000',
    'http://192.168.1.20:3000',
    'http://172.16.4.4:3000'
  ])('treats private-range origin %s as not exposed', (ORIGIN) => {
    expect(isExposedDeployment({ ORIGIN })).toBe(false);
  });

  it('treats a public range that merely looks private as exposed', () => {
    // 172.32.x is outside the 172.16-31 private block.
    expect(isExposedDeployment({ ORIGIN: 'http://172.32.0.1:3000' })).toBe(true);
  });

  it('lets EXPOSED_MODE=1 force exposed even on loopback', () => {
    expect(isExposedDeployment({ ORIGIN: 'http://localhost:5173', EXPOSED_MODE: '1' })).toBe(true);
  });

  it('lets EXPOSED_MODE=0 opt out for a deliberately trusted network', () => {
    expect(isExposedDeployment({ ORIGIN: 'https://gsc.example.com', EXPOSED_MODE: '0' })).toBe(false);
  });

  it('fails safe when the origin cannot be parsed', () => {
    expect(isExposedDeployment({ ORIGIN: 'not a url' })).toBe(true);
  });
});
