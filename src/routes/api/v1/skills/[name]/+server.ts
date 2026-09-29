import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiToken } from '$lib/server/api-token';
import { PROMPTS } from '$lib/server/mcp';

/** Сам SKILL.md: положи его в ~/.claude/skills/<имя>/SKILL.md. */
export const GET: RequestHandler = async ({ request, params }) => {
  requireApiToken(request);
  const skill = PROMPTS.find((p) => p.name === params.name);
  if (!skill) throw error(404, 'skill not found');
  const body = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.text}\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${skill.name}.md"`
    }
  });
};
