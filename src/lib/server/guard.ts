import { error, redirect, type Handle } from '@sveltejs/kit';
import { db } from './db';
import type { Db } from './db';
import { getSession, initAuth, countUsers } from './auth-session';
import type { User } from './auth-session';
import { als } from './request-context';
import { env } from '$env/dynamic/private';
import { getConfigValue, isSetupComplete } from './config';

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
  | { kind: 'redirect'; to: string };

export function decideRoute(ctx: {
  setupComplete: boolean;
  loginEnabled: boolean;
  user: User | null;
  path: string;
}): RouteDecision {
  const { setupComplete, loginEnabled, user, path } = ctx;

  if (!setupComplete) {
    if (path === '/setup' || isPublicPath(path)) return { kind: 'pass', asLocalAdmin: false };
    return { kind: 'redirect', to: '/setup' };
  }

  if (!loginEnabled) {
    if (isPublicPath(path)) return { kind: 'pass', asLocalAdmin: false };
    return { kind: 'pass', asLocalAdmin: true };
  }

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
    path
  });

  if (decision.kind === 'redirect') {
    return als.run({ userId: user?.id ?? null }, async () => {
      throw redirect(303, decision.to);
    });
  }

  const effectiveUser = decision.asLocalAdmin ? LOCAL_ADMIN : user;
  event.locals.user = effectiveUser;
  return als.run({ userId: effectiveUser?.id ?? null }, async () => resolve(event));
};
