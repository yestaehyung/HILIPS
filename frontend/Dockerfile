# syntax=docker/dockerfile:1.6
#
# HILIPS frontend — Next.js 15 + React 19
#
# Build:
#   docker build -t hilips-frontend ./frontend
#
# Run:
#   docker run --rm -p 3000:3000 \
#     -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
#     hilips-frontend

# ---------- deps stage ----------
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        npm install --legacy-peer-deps; \
    fi

# ---------- build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js build-time public env
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm build; \
    else \
        npm run build; \
    fi

# ---------- runner stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Minimal runtime: reuse node_modules + build artifacts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm", "start"]
