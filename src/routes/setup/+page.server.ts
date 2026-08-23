import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
  configSource, setConfigValue, setConfigValues, ensureAuthSecret,
  getGoogleClientId, getGoogleClientSecret, isSetupComplete
} from '$lib/server/config';
import {
  createUserWithHash, createSession, countAdmins, hashPassword, SESSION_TTL_MS
} from '$lib/server/auth-session';
import { requireAdmin } from '$lib/server/guard';

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
  default: async ({ request, cookies, locals }) => {
    const database = db();

    // Bootstrap is anonymous by design, but only while there is nothing to
    // protect. Once setup is complete, changing the Google credentials or the
    // access mode is an admin operation like any other.
    if (isSetupComplete(database)) requireAdmin(locals);

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

    let admin: { email: string; password: string } | null = null;
    if (mode === 'exposed') {
      const email = String(form.get('admin_email') ?? '').trim();
      const password = String(form.get('admin_password') ?? '');
      const confirm = String(form.get('admin_password2') ?? '');
      if (!email) return fail(400, { error: 'Укажи email админа' });
      if (password.length < 8) return fail(400, { error: 'Пароль минимум 8 символов' });
      if (badWrap(password)) return fail(400, { error: 'Убери кавычки/пробелы вокруг пароля' });
      if (password !== confirm) return fail(400, { error: 'Пароли не совпадают' });
      admin = { email, password };
    }

    // Everything above only reads. Writing the Google credentials is what makes
    // isSetupComplete() true, so doing it before the admin is validated left a
    // rejected form with a configured app and no login at all.
    const passwordHash =
      admin && countAdmins(database) === 0 ? await hashPassword(admin.password) : null;

    const user = database.transaction(() => {
      ensureAuthSecret(database);
      setConfigValues(database, values);
      if (!admin) return null;
      // Unconditional: an exposed instance that skips this because an admin
      // already exists is an exposed instance with login switched off.
      setConfigValue(database, 'LOGIN_ENABLED', '1');
      if (!passwordHash) return null;
      return createUserWithHash(database, {
        email: admin.email, password_hash: passwordHash, role: 'admin'
      });
    })();

    if (user) {
      const token = createSession(database, user.id);
      cookies.set('gsc_session', token, {
        path: '/', httpOnly: true, sameSite: 'lax',
        secure: (env.ORIGIN ?? '').startsWith('https://'),
        maxAge: Math.floor(SESSION_TTL_MS / 1000)
      });
    }

    throw redirect(303, '/');
  }
};
