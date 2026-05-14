ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/ packages/
COPY modules/ modules/
COPY apps/api/ apps/api/
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@platform/api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
