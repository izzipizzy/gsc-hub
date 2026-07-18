import type { PageServerLoad, Actions } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listAccounts } from '$lib/server/accounts';
import { signIn } from '../auth';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (!user) throw error(401, 'unauthorized');
  const ownerId = user.role === 'admin' ? undefined : user.id;
  return { accounts: listAccounts(db(), ownerId), user };
};

export const actions: Actions = {
  connect: signIn
};
