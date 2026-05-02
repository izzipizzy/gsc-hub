import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () => {
  // Просто редирект — load() запустится заново.
  throw redirect(303, '/properties');
};
