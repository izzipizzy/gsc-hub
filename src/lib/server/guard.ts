import { error, redirect, type Handle } from '@sveltejs/kit';
import { db } from './db';
import type { Db } from './db';
import { getSession, initAuth, countUsers, countAdmins } from './auth-session';
import type { User } from './auth-session';
import { als } from './request-context';
import { env } from '$env/dynamic/private';
import { getConfigValue, isSetupComplete } from './config';
import { isExposedRequest } from './exposure';

export function isPublicPath(path: string): boolean {
  return (
    path === '/login' ||
    path.startsWith('/auth/') ||
    path.startsWith('/_app/') ||
    path === '/favicon.svg' ||
    path === '/favicon.ico'
  );
}

export function isManagerAllowed(path: string): boolean {
  return path === '/' || path === '/logout' || path.startsWith('/auth/');
}

export function requireAdmin(locals: App.Locals): void {
  if (locals.user?.role !== 'admin') throw error(403, 'forbidden');
}

export function loginEnabled(db: Db): boolean {
  const envAdmin =
    (process.env.ADMIN_EMAIL ?? '').trim() !== '' &&
    (process.env.ADMIN_PASSWORD ?? '').trim() !== '';
  return envAdmin || getConfigValue(db, 'LOGIN_ENABLED') === '1' || countUsers(db) > 0;
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initAuth(db(), { ADMIN_EMAIL: env.ADMIN_EMAIL, ADMIN_PASSWORD: env.ADMIN_PASSWORD })
      .catch((e) => {
        initPromise = null; // allow a later request to retry if init failed
        throw e;
      });
  }
  return initPromise;
}

export const LOCAL_ADMIN: User = {
  id: 'local-admin', email: 'local@localhost', role: 'admin', created_at: 0
};

export type RouteDecision =
  | { kind: 'pass'; asLocalAdmin: boolean }
  | { kind: 'redirect'; to: string }
  | { kind: 'error'; status: number; message: string };

export function decideRoute(ctx: {
  setupComplete: boolean;
  loginEnabled: boolean;
  user: User | null;
  path: string;
  exposed?: boolean;
  hasAdmin?: boolean;
}): RouteDecision {
  const { setupComplete, loginEnabled, user, path, exposed = false, hasAdmin = true } = ctx;

  // Two shortcuts below are safe only on loopback: the anonymous setup wizard,
  // and passing every request as local admin when login is off. On an instance
  // reachable from the internet either one hands over full admin, so refuse to
  // serve anything at all until it is configured with a login.
  // hasAdmin, not loginEnabled: the latter is true as soon as any user exists,
  // and a manager cannot reach /setup or /admin/users — an instance in that
  // state is running with nobody able to administer it.
  if (exposed && (!setupComplete || !loginEnabled || !hasAdmin)) {
    return {
      kind: 'error',
      status: 503,
      message:
        'Not configured for exposed access: set ADMIN_EMAIL and ADMIN_PASSWORD ' +
        '(and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) in the deployment environment.'
    };
  }

  if (!setupComplete) {
    if (path === '/setup' || isPublicPath(path)) return { kind: 'pass', asLocalAdmin: false };
    return { kind: 'redirect', to: '/setup' };
  }

  if (!loginEnabled) return { kind: 'pass', asLocalAdmin: true };

  if (isPublicPath(path)) return { kind: 'pass', asLocalAdmin: false };
  if (!user) return { kind: 'redirect', to: '/login' };
  if (user.role !== 'admin' && !isManagerAllowed(path)) return { kind: 'redirect', to: '/' };
  return { kind: 'pass', asLocalAdmin: false };
}

export const authGuard: Handle = async ({ event, resolve }) => {
  await ensureInit();
  const database = db();
  const path = event.url.pathname;

  const token = event.cookies.get('gsc_session');
  const user = token ? getSession(database, token) : null;

  const decision = decideRoute({
    setupComplete: isSetupComplete(database),
    loginEnabled: loginEnabled(database),
    user,
    path,
    // Two signals, because neither is complete on its own. The configured
    // origin cannot see a publisher the app was never told about — a tunnel, an
    // OrbStack label, a bind on 0.0.0.0 — while the request host is only as
    // trustworthy as the Host header. Either saying "exposed" is enough;
    // EXPOSED_MODE=0 silences both for a network the operator trusts.
    exposed: isExposedRequest(process.env, event.url.hostname),
    hasAdmin: countAdmins(database) > 0
  });

  if (decision.kind === 'error') {
    return als.run({ userId: null }, async () => {
      throw error(decision.status, decision.message);
    });
  }

  if (decision.kind === 'redirect') {
    return als.run({ userId: user?.id ?? null }, async () => {
      throw redirect(303, decision.to);
    });
  }

  const effectiveUser = decision.asLocalAdmin ? LOCAL_ADMIN : user;
  event.locals.user = effectiveUser;
  return als.run({ userId: effectiveUser?.id ?? null }, async () => resolve(event));
};
