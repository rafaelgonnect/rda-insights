# Multi-stage build for Next.js 16 + standalone output disabled.
# Used when deploying via Docker Compose (build.context: <git-url>).
# When deploying as EasyPanel App service, Nixpacks ignores this file.

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stub env values so lib/env.ts zod parsing passes at build time.
# Real values come from the runtime environment (set by EasyPanel).
ENV APP_USERNAME=build
ENV APP_PASSWORD=build-stub-password
ENV OPENROUTER_API_KEY=sk-build-stub
ENV OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
ENV SUPERSET_URL=http://stub:8088
ENV SUPERSET_INTERNAL_URL=http://stub:8088
ENV SUPERSET_USERNAME=admin
ENV SUPERSET_PASSWORD=build-stub-password
ENV REDIS_URL=redis://stub:6379/2
ENV MAX_USD_MONTH=20

RUN npm run build

# --- runner ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
