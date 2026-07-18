import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { verifyLogin, createSession, SESSION_TTL_MS } from '$lib/server/auth-session';
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
    const key = `${email.toLowerCase()}|${getClientAddress()}`;

    if (isBlocked(key)) return fail(429, { error: 'Слишком много попыток. Подождите 15 минут.' });

    const user = await verifyLogin(db(), email, password);
    if (!user) {
      recordFailure(key);
      return fail(401, { error: 'Неверный email или пароль', email });
    }
    clearFailures(key);
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
