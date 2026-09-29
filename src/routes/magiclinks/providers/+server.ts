import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { magicProviderInfos } from '$lib/server/magiclinks-providers';

// Живые балансы провайдеров для окна покупки: по большему балансу выбирается
// провайдер по умолчанию. Читается только при открытии окна, ничего не кешируем.
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const providers = await magicProviderInfos(db());
  return json({ providers });
};
