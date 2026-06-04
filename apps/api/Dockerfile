ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable

WORKDIR /app

# Copy workspace manifests; install before copying source so this layer is
# cached unless lockfile changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/ packages/
COPY modules/ modules/
COPY apps/api/ apps/api/

RUN pnpm install --frozen-lockfile

# Build workspace package dists so internal imports resolve at runtime.
# Apps/api itself is run via tsx (no compile step needed in dev).
RUN pnpm exec turbo run build --filter=@platform/api^...

EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "apps/api/src/index.ts"]
