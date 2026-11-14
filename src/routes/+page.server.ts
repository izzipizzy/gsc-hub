import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Home is the Dashboard. A manager (no dashboard access) lands on the Google
// accounts list, which used to live here.
export const load: PageServerLoad = ({ locals }) => {
  throw redirect(303, locals.user?.role === 'admin' ? '/dashboard' : '/settings/accounts');
};
