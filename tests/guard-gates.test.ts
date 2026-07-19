import { describe, it, expect } from 'vitest';
import { decideRoute } from '../src/lib/server/guard';

describe('decideRoute', () => {
  const admin = { id: 'a', email: 'a@x', role: 'admin' as const, created_at: 0 };
  const manager = { id: 'm', email: 'm@x', role: 'manager' as const, created_at: 0 };

  it('forces /setup when setup incomplete (non-public path)', () => {
    expect(decideRoute({ setupComplete: false, loginEnabled: false, user: null, path: '/properties' }))
      .toEqual({ kind: 'redirect', to: '/setup' });
  });

  it('allows /setup itself when setup incomplete', () => {
    expect(decideRoute({ setupComplete: false, loginEnabled: false, user: null, path: '/setup' }))
      .toEqual({ kind: 'pass', asLocalAdmin: false });
  });

  it('single-user: passes as local admin when login disabled', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: false, user: null, path: '/properties' }))
      .toEqual({ kind: 'pass', asLocalAdmin: true });
  });

  it('single-user: passes as local admin on the OAuth callback so signIn resolves an ownerId', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: false, user: null, path: '/auth/callback/google' }))
      .toEqual({ kind: 'pass', asLocalAdmin: true });
  });

  it('login mode: redirects anon to /login', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: true, user: null, path: '/properties' }))
      .toEqual({ kind: 'redirect', to: '/login' });
  });

  it('login mode: /login itself is public', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: true, user: null, path: '/login' }))
      .toEqual({ kind: 'pass', asLocalAdmin: false });
  });

  it('login mode: manager blocked from non-manager path', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: true, user: manager, path: '/properties' }))
      .toEqual({ kind: 'redirect', to: '/' });
  });

  it('login mode: manager blocked from /setup', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: true, user: manager, path: '/setup' }))
      .toEqual({ kind: 'redirect', to: '/' });
  });

  it('login mode: admin allowed everywhere', () => {
    expect(decideRoute({ setupComplete: true, loginEnabled: true, user: admin, path: '/setup' }))
      .toEqual({ kind: 'pass', asLocalAdmin: false });
  });
});
