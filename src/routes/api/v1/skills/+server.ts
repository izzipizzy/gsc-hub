import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiToken } from '$lib/server/api-token';
import { PROMPTS } from '$lib/server/mcp';

// Скилы можно забрать файлами, а не только промптами MCP: репозиторий для
// этого не нужен, достаточно ключа.
export const GET: RequestHandler = async ({ request, url }) => {
  requireApiToken(request);
  return json({
    skills: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      url: `${url.origin}/api/v1/skills/${encodeURIComponent(p.name)}`
    }))
  });
};
