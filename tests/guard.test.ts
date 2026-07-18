import { describe, it, expect } from 'vitest';
import { isPublicPath, isManagerAllowed } from '../src/lib/server/guard';

describe('guard paths', () => {
  it('public paths need no session', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback/google')).toBe(true);
    expect(isPublicPath('/_app/immutable/x.js')).toBe(true);
    expect(isPublicPath('/dashboard')).toBe(false);
  });
  it('manager is allowed only home, logout, auth', () => {
    expect(isManagerAllowed('/')).toBe(true);
    expect(isManagerAllowed('/logout')).toBe(true);
    expect(isManagerAllowed('/auth/signin/google')).toBe(true);
    expect(isManagerAllowed('/dashboard')).toBe(false);
    expect(isManagerAllowed('/admin/users')).toBe(false);
  });
});
