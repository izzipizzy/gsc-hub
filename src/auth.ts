import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/core/providers/google';
import { env as privateEnv } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { upsertAccount } from '$lib/server/accounts';
import { als } from '$lib/server/request-context';
import {
  getGoogleClientId, getGoogleClientSecret, ensureAuthSecret
} from '$lib/server/config';

export const { handle, signIn, signOut } = SvelteKitAuth(async () => {
  const database = db();
  return {
    secret: ensureAuthSecret(database),
    trustHost: true,
    // Non-secure only on local http (localhost:5173); secure on an https origin.
    // adapter-node would otherwise report http as https, causing PKCE cookie mismatch.
    useSecureCookies: (privateEnv.ORIGIN ?? '').startsWith('https://'),
    providers: [
      Google({
        clientId: getGoogleClientId(database) ?? '',
        clientSecret: getGoogleClientSecret(database) ?? '',
        authorization: {
          params: {
            scope:
              'openid email https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/siteverification',
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: 'true'
          }
        }
      })
    ],
    callbacks: {
      async signIn({ account, profile }) {
        // Custom: вместо app-сессии апсертим запись в google_accounts.
        if (
          !account ||
          !profile?.sub ||
          !account.access_token ||
          !account.refresh_token ||
          !account.expires_at
        ) {
          return '/?error=missing_token';
        }

        const ownerId = als.getStore()?.userId ?? null;
        if (!ownerId) return '/login?error=no_session';

        try {
          upsertAccount(db(), {
            id: profile.sub,
            email: (profile.email as string) ?? '',
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            scope: (account.scope as string) ?? '',
            owner_id: ownerId
          });
        } catch (err) {
          console.error('[auth] upsertAccount failed:', err);
          return '/?error=db_error';
        }

        // Возвращаем редирект-URL → Auth.js не создаёт сессию, кидает на /.
        return '/';
      }
    },
    pages: {
      signIn: '/',
      error: '/'
    }
  };
});
