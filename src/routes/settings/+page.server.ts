import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Old address kept working after the settings split (2026-11-14).
export const load: PageServerLoad = () => {
  throw redirect(308, '/settings/accounts');
};
