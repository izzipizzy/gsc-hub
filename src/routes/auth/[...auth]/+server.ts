// Auth.js обрабатывает /auth/* через handle() из hooks.server.ts.
// Этот файл нужен только чтобы SvelteKit не вернул 404 для /auth/callback/google.
import type { RequestHandler } from './$types';

const passthrough: RequestHandler = async ({ request }) => {
  // Не должен вызываться — handle() перехватит раньше. На всякий случай — 404.
  return new Response('Not Found', { status: 404 });
};

export const GET = passthrough;
export const POST = passthrough;
