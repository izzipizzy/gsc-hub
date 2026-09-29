import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// With no ORIGIN/AUTH_URL the access guard fails closed and treats the app as
// exposed, which on a fresh clone turned `pnpm dev` into a wall of 503s. The
// dev server listens on loopback unless started with --host, so it can state
// its own origin. It only fills a gap: a configured origin wins, and a request
// arriving on a non-loopback host is still treated as exposed by the guard.
function devLoopbackOrigin(): Plugin {
  return {
    name: 'dev-loopback-origin',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address();
        const unset = (v: string | undefined) => (v ?? '').trim() === '';
        if (addr && typeof addr === 'object' && unset(process.env.ORIGIN) && unset(process.env.AUTH_URL)) {
          process.env.ORIGIN = `http://localhost:${addr.port}`;
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [sveltekit(), devLoopbackOrigin()],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/gsc-cache-reset.ts'],
    environment: 'node'
  }
});
