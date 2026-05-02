import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { listAccounts } from '$lib/server/accounts';
import { signIn } from '../auth';

export const load: PageServerLoad = async () => {
  return { accounts: listAccounts(db()) };
};

export const actions: Actions = {
  connect: signIn
};
