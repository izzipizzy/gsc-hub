import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { relabelAccount } from '$lib/server/accounts';
import { requireAdmin } from '$lib/server/guard';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const form = await request.formData();
  const label = (form.get('label') as string | null)?.trim() || null;
  relabelAccount(db(), params.id!, label);
  throw redirect(303, '/');
};
