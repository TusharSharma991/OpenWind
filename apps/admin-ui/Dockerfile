ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/ packages/
COPY modules/ modules/
COPY apps/admin-ui/ apps/admin-ui/
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@platform/admin-ui...

FROM base AS runner
WORKDIR /app
RUN npm install -g serve

COPY --from=builder /app/apps/admin-ui/dist ./dist

# Runtime env vars — written to dist/env.js by the entrypoint so the SPA
# can read them from window.__CONFIG__ without a rebuild.
ENV ZITADEL_ISSUER=http://localhost:8080
ENV ZITADEL_OIDC_CLIENT_ID=
ENV ZITADEL_OIDC_CLIENT_SECRET=

COPY apps/admin-ui/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
