# Backend Dockerfile — multi-stage build
# Stage 1: Build TypeScript
# Stage 2: Production image with compiled JS only

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

RUN npx tsc --outDir dist || true

# ── Production ─────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist/ ./dist/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
