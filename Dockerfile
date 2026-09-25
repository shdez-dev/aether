FROM node:24.18.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS web
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN pnpm --filter @aether/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@aether/web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

FROM base AS runtime
ENV NODE_ENV=production
CMD ["node", "--version"]
