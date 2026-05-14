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
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
