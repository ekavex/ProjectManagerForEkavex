# --- build ---
FROM node:22-bookworm-slim AS build

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace @ekavist/shared --workspace @ekavist/web --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @ekavist/shared \
 && npm run build --workspace @ekavist/web

# --- runtime ---
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# SPA fallback: all routes serve index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 80
