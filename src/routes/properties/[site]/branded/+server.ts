import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getBrandedTerms, setBrandedTerms } from '$lib/server/branded';

// Save a brand-term override (empty list reverts to the domain default).
export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as { terms?: unknown } | null;
  if (!body || !Array.isArray(body.terms)) throw error(400, 'terms array required');
  setBrandedTerms(db(), params.site, body.terms.map(String));
  return json({ brandedTerms: getBrandedTerms(db(), params.site) });
};
