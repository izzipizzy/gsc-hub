import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/core/providers/google';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET } from '$env/static/private';
import { db } from '$lib/server/db';
import { upsertAccount } from '$lib/server/accounts';

export const { handle, signIn, signOut } = SvelteKitAuth({
  secret: AUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            'openid email https://www.googleapis.com/auth/webmasters.readonly',
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

      try {
        upsertAccount(db(), {
          id: profile.sub,
          email: (profile.email as string) ?? '',
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
          scope: (account.scope as string) ?? ''
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
});
