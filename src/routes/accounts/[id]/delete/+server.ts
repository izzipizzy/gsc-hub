import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { deleteAccount, getAccount } from '$lib/server/accounts';
import { revokeToken } from '$lib/server/google';

export const POST: RequestHandler = async ({ params }) => {
  const acc = getAccount(db(), params.id!);
  if (acc) {
    try {
      await revokeToken(acc.refresh_token);
    } catch {
      // не блокируем удаление, если revoke не прошёл
    }
    deleteAccount(db(), params.id!);
  }
  throw redirect(303, '/');
};
