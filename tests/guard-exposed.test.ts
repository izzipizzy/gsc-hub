import { describe, it, expect } from 'vitest';
import { decideRoute } from '../src/lib/server/guard';

// An instance reachable from the internet must never fall back to the
// single-user local-admin shortcut, and must never serve the setup wizard
// anonymously. Both are safe only on a loopback deployment.
describe('decideRoute on an exposed deployment', () => {
  const admin = { id: 'a', email: 'a@x', role: 'admin' as const, created_at: 0 };

  it('refuses to pass as local admin when login is disabled', () => {
    expect(
      decideRoute({
        exposed: true,
        setupComplete: true,
        loginEnabled: false,
        user: null,
        path: '/properties'
      })
    ).toEqual({ kind: 'error', status: 503, message: expect.any(String) });
  });

  it('refuses the anonymous setup wizard when setup is incomplete', () => {
    expect(
      decideRoute({
        exposed: true,
        setupComplete: false,
        loginEnabled: false,
        user: null,
        path: '/setup'
      })
    ).toEqual({ kind: 'error', status: 503, message: expect.any(String) });
  });

  it('refuses public assets too, so a misconfigured instance serves nothing', () => {
    expect(
      decideRoute({
        exposed: true,
        setupComplete: true,
        loginEnabled: false,
        user: null,
        path: '/login'
      })
    ).toEqual({ kind: 'error', status: 503, message: expect.any(String) });
  });

  it('still redirects anonymous requests to /login once login is enabled', () => {
    expect(
      decideRoute({
        exposed: true,
        setupComplete: true,
        loginEnabled: true,
        hasAdmin: true,
        user: null,
        path: '/properties'
      })
    ).toEqual({ kind: 'redirect', to: '/login' });
  });

  it('still passes an authenticated admin once login is enabled', () => {
    expect(
      decideRoute({
        exposed: true,
        setupComplete: true,
        loginEnabled: true,
        hasAdmin: true,
        user: admin,
        path: '/properties'
      })
    ).toEqual({ kind: 'pass', asLocalAdmin: false });
  });

  it('leaves the loopback single-user shortcut untouched', () => {
    expect(
      decideRoute({
        exposed: false,
        setupComplete: true,
        loginEnabled: false,
        user: null,
        path: '/properties'
      })
    ).toEqual({ kind: 'pass', asLocalAdmin: true });
  });

  it('refuses when the only account left is a manager', () => {
    // loginEnabled() is true as soon as any user exists, but a manager cannot
    // reach /setup or /admin/users — so "login is on" would be served by an
    // instance nobody can administer.
    expect(
      decideRoute({
        exposed: true,
        setupComplete: true,
        loginEnabled: true,
        hasAdmin: false,
        user: null,
        path: '/properties'
      })
    ).toEqual({ kind: 'error', status: 503, message: expect.any(String) });
  });
});
