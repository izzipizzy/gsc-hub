import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { relabelAccount } from '$lib/server/accounts';

export const POST: RequestHandler = async ({ params, request }) => {
  const form = await request.formData();
  const label = (form.get('label') as string | null)?.trim() || null;
  relabelAccount(db(), params.id!, label);
  throw redirect(303, '/');
};
