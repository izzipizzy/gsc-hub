import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';

export const POST: RequestHandler = ({ locals }) => {
  requireAdmin(locals);
  // Просто редирект — load() запустится заново.
  throw redirect(303, '/properties');
};
