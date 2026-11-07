# Dependency compatibility

Registry audit: 2026-11-07. Application and video package manifests and lockfiles were updated against npm stable dist-tags, including Tailwind 4, better-sqlite3 13, Vitest 5 and ESLint 10.

Compatibility exceptions:

- SvelteKit stays on the latest 2.x (2.70.4) and adapter-node on 5.5.7. Current `@auth/sveltekit` 1.11.3 only declares SvelteKit 1/2 support; adapter-node 6 requires SvelteKit 3. Revisit together when Auth.js supports Kit 3.
- TypeScript stays on 6.0.3 in both packages. `svelte-check` 4.7.8 declares TypeScript 5/6 support; the video's Remotion ESLint stack crashes with TypeScript 7 (`ts-api-utils` accesses the removed compiler API). Revisit when both integrations support TypeScript 7.
- The SvelteKit cookie security override remains while Kit 2 requests the older cookie range.

Tailwind was migrated with the official v4 upgrade tool, then switched to `@tailwindcss/vite`. Theme tokens and reusable utilities now live in `src/app.css`; obsolete PostCSS/autoprefixer and JS Tailwind configuration were removed. Browser requirements: Safari 16.4+, Chrome 111+, Firefox 128+ ([official upgrade guide](https://tailwindcss.com/docs/upgrade-guide)).

Use Node 22.18+ and the pinned pnpm 12.18.0. Docker uses the current Node 22 Alpine image. The video project retains its separate npm lockfile; validate it with `npm ci`, `npm run lint`, and `npm run build` in `videos/gsc-hub-demo`.
