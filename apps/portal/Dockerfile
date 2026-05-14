ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/ packages/
COPY modules/ modules/
COPY apps/portal/ apps/portal/
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@platform/portal...

FROM base AS runner
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/apps/portal/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
