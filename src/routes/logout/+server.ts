import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { destroySession } from '$lib/server/auth-session';

export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get('gsc_session');
  if (token) destroySession(db(), token);
  cookies.delete('gsc_session', { path: '/' });
  throw redirect(303, '/login');
};
