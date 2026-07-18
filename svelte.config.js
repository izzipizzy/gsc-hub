import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // adapter-node assumes https when deriving its own origin, so a plain-http
    // POST from http://localhost:5173 (the OAuth-connect URL — Google rejects the
    // .local domain) fails the same-origin CSRF check. Trust that loopback origin
    // explicitly; daily use over https://gsc.local keeps matching normally.
    csrf: { trustedOrigins: ['http://localhost:5173'] }
  }
};
