# syntax=docker/dockerfile:1

# ---- base: node + pnpm ----
FROM node:26.13.1-alpine AS base
RUN npm install -g pnpm@12.23.0
WORKDIR /app

# ---- web: build the React frontend (Vite + shadcn/ui) ----
FROM base AS web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter web
COPY web/ web/
RUN pnpm --filter web build

# ---- deps: server production dependencies (better-sqlite3 needs a toolchain) ----
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter snipeit-asset-scanner

# ---- runtime: slim image with server + built frontend ----
FROM node:26.13.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY --from=web /app/web/dist ./web/dist
# db/ is the scanner-data volume (SQLite + photos/)
RUN mkdir -p db/photos
EXPOSE 3000
CMD ["node", "server.js"]
