import type { RequestHandler } from './$types';
import { requireApiToken } from '$lib/server/api-token';
import doc from '$lib/api-doc.md?raw';

// Документация API для агентов — простой markdown по адресу /api/v1/doc.md.
// Отдаётся по тому же ключу, что и сам API, или админу из-под логина: наружу без
// ключа список ручек хаба не светится.
export const GET: RequestHandler = async ({ request, locals, url }) => {
  if (locals.user?.role !== 'admin') requireApiToken(request);
  return new Response(doc.replaceAll('{{BASE}}', url.origin), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' }
  });
};
