import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchQueryHistory } from '$lib/server/google';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  const days = Number(url.searchParams.get('days') ?? '480');
  if (!q) throw error(400, 'q required');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const result = await fetchQueryHistory(db(), q, days);
  return json(result);
};
