import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Redirect GET requests to / where the Connect form lives.
// The actual OAuth flow is initiated via the ?/connect form action on /.
export const GET: RequestHandler = () => {
  throw redirect(302, '/');
};
