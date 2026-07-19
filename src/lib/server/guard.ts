import { error, redirect, type Handle } from '@sveltejs/kit';
import { db } from './db';
import type { Db } from './db';
import { getSession, initAuth, countUsers } from './auth-session';
import { als } from './request-context';
import { env } from '$env/dynamic/private';
import { getConfigValue } from './config';

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

export const authGuard: Handle = async ({ event, resolve }) => {
  await ensureInit();
  const token = event.cookies.get('gsc_session');
  const user = token ? getSession(db(), token) : null;
  event.locals.user = user;
  const path = event.url.pathname;

  return als.run({ userId: user?.id ?? null }, async () => {
    if (isPublicPath(path)) return resolve(event);
    if (!user) throw redirect(303, '/login');
    if (user.role !== 'admin' && !isManagerAllowed(path)) throw redirect(303, '/');
    return resolve(event);
  });
};
