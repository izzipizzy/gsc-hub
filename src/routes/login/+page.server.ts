import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
  verifyLogin, createSession, normalizeEmail, SESSION_TTL_MS
} from '$lib/server/auth-session';
import { recordFailure, clearFailures, isBlocked } from '$lib/server/login-throttle';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(303, '/');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const address = getClientAddress();
    // Normalised the same way verifyLogin looks the user up — otherwise every
    // extra space is a fresh bucket and the limit means nothing. The second key
    // caps one address spraying many accounts.
    const keys = [`${normalizeEmail(email)}|${address}`, `addr|${address}`];

    if (keys.some((k) => isBlocked(k))) {
      return fail(429, { error: 'Слишком много попыток. Подождите 15 минут.' });
    }

    const user = await verifyLogin(db(), email, password);
    if (!user) {
      for (const k of keys) recordFailure(k);
      return fail(401, { error: 'Неверный email или пароль', email });
    }
    for (const k of keys) clearFailures(k);
    const token = createSession(db(), user.id);
    cookies.set('gsc_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: (env.ORIGIN ?? '').startsWith('https://'),
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    });
    throw redirect(303, '/');
  }
};
