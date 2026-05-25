FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# Native build deps for better-sqlite3 (node-gyp)
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# SvelteKit reads $env/static/private at build time via Vite.
# Provide placeholder values so the build succeeds; real secrets are
# injected at runtime via environment variables (never baked into the image).
ARG GOOGLE_CLIENT_ID=build_placeholder
ARG GOOGLE_CLIENT_SECRET=build_placeholder
ARG AUTH_SECRET=build_placeholder_32_chars_minimum_x

RUN GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET \
    AUTH_SECRET=$AUTH_SECRET \
    pnpm build

RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "build/index.js"]
