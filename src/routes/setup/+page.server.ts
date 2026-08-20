import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
  configSource, setConfigValue, setConfigValues, ensureAuthSecret,
  getGoogleClientId, getGoogleClientSecret, isSetupComplete
} from '$lib/server/config';
import { createUser, createSession, countAdmins, SESSION_TTL_MS } from '$lib/server/auth-session';

export const load: PageServerLoad = async ({ url }) => {
  const database = db();
  // adapter-node derives https for its origin even on a plain-http loopback, but
  // Google's OAuth redirect for localhost/127.0.0.1 MUST be http — showing https
  // here would make the user register a URI Google rejects. Force http on loopback.
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const origin = loopback ? `http://${url.host}` : url.origin;
  return {
    complete: isSetupComplete(database),
    redirectUri: `${origin}/auth/callback/google`,
    origin,
    clientIdSet: !!getGoogleClientId(database),
    clientSecretSet: !!getGoogleClientSecret(database),
    clientIdSource: configSource(database, 'GOOGLE_CLIENT_ID'),
    clientSecretSource: configSource(database, 'GOOGLE_CLIENT_SECRET'),
    hasAdmin: countAdmins(database) > 0
  };
};

function badWrap(s: string): boolean {
  return s !== s.trim() || /^["'].*["']$/.test(s);
}

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const database = db();
    const form = await request.formData();
    const clientId = String(form.get('client_id') ?? '').trim();
    const clientSecret = String(form.get('client_secret') ?? '').trim();
    const mode = String(form.get('mode') ?? 'local');

    const cidFromEnv = configSource(database, 'GOOGLE_CLIENT_ID') === 'env';
    const csecFromEnv = configSource(database, 'GOOGLE_CLIENT_SECRET') === 'env';

    const values: Record<string, string> = {};
    if (!cidFromEnv) {
      if (!clientId) return fail(400, { error: 'Укажи Google Client ID' });
      values.GOOGLE_CLIENT_ID = clientId;
    }
    if (!csecFromEnv) {
      if (!clientSecret) return fail(400, { error: 'Укажи Google Client Secret' });
      values.GOOGLE_CLIENT_SECRET = clientSecret;
    }

    if (mode === 'exposed') {
      const email = String(form.get('admin_email') ?? '').trim();
      const password = String(form.get('admin_password') ?? '');
      const confirm = String(form.get('admin_password2') ?? '');
      if (!email) return fail(400, { error: 'Укажи email админа' });
      if (password.length < 8) return fail(400, { error: 'Пароль минимум 8 символов' });
      if (badWrap(password)) return fail(400, { error: 'Убери кавычки/пробелы вокруг пароля' });
      if (password !== confirm) return fail(400, { error: 'Пароли не совпадают' });

      if (countAdmins(database) === 0) {
        const user = await createUser(database, { email, password, role: 'admin' });
        setConfigValue(database, 'LOGIN_ENABLED', '1');
        const token = createSession(database, user.id);
        cookies.set('gsc_session', token, {
          path: '/', httpOnly: true, sameSite: 'lax',
          secure: (env.ORIGIN ?? '').startsWith('https://'),
          maxAge: Math.floor(SESSION_TTL_MS / 1000)
        });
      }
    }

    ensureAuthSecret(database);
    setConfigValues(database, values);

    throw redirect(303, '/');
  }
};
