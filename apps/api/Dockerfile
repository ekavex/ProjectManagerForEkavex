# Ekavist API.
#
# Multi-stage so the shipped image carries the compiled output and production
# dependencies only: no TypeScript, no test framework, and — deliberately — no Prisma CLI,
# which is where the one accepted advisory lives (decision D-014). Migrations are applied
# by a separate step in the deployment pipeline, not by the server on boot: a container
# that migrates on start will race itself the moment there are two replicas.

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# OpenSSL here, not only in the runtime stage: `prisma generate` picks the query engine by
# sniffing the OpenSSL version present at generate time, and with none installed it guesses
# debian-openssl-1.1.x. The runtime stage then has 3.0 and the server dies on its first
# query with "could not locate the Query Engine".
RUN apt-get update \
 && apt-get install --no-install-recommends -y openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Copy only what the install needs first, so a code change does not invalidate the
# dependency layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace @ekavist/shared --workspace @ekavist/api --include-workspace-root

# Both workspaces extend the root tsconfig; without it `tsc` fails with TS5083 and then a
# cascade of confusing type errors from the defaults it falls back to.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build --workspace @ekavist/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npx tsc -p apps/api/tsconfig.json

# --- production dependencies -------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# `--omit=dev` alone is not enough, which only building the image showed. `@prisma/client`
# declares the `prisma` CLI as an *optional peer* dependency and npm installs optional
# peers by default, so the CLI — and, through it, TypeScript and the `deepmerge-ts`
# advisory of D-014 — was being shipped inside the runtime image despite the comment at the
# top of this file. Omitting optional dependencies as well is what makes that comment
# true, and takes node_modules from 327 MB to 164 MB.
#
# Not `--omit=peer`: that also drops packages installed to satisfy a real peer range —
# `date-fns`, required by `date-fns-tz` — and the server then dies on its first import.
RUN npm ci --omit=dev --omit=optional \
      --workspace @ekavist/shared --workspace @ekavist/api --include-workspace-root

# --- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# OpenSSL is required by the Prisma query engine.
RUN apt-get update \
 && apt-get install --no-install-recommends -y openssl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /repo

COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/package.json package.json
COPY --from=deps /repo/apps/api/package.json apps/api/package.json
COPY --from=deps /repo/packages/shared/package.json packages/shared/package.json

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma/client node_modules/@prisma/client

# The image runs unprivileged; `node` already exists in the base image.
USER node

EXPOSE 4000

# The health endpoint touches the database, so an unhealthy container is one that cannot
# actually serve a request rather than merely one whose process is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 4000) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
