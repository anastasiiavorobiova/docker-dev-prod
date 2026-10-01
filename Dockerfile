ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch(`http://localhost:${process.env.PORT}/health`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]


FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev


FROM base AS builder
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM base AS dev
ENV NODE_ENV=development

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY tsconfig.json ./
COPY src ./src

USER node

CMD ["node_modules/.bin/tsx", "watch", "src/server.ts"]


FROM base AS runner
ENV NODE_ENV=production

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER node

CMD ["node", "dist/server.js"]
