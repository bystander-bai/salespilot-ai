FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
COPY packages/contracts/package*.json packages/contracts/
RUN npm ci

FROM base AS api
COPY . .
ENV DATABASE_URL=file:/app/data/dev.db
RUN npm run db:generate && npm run build:contracts && npm run build:api
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && node apps/api/dist/server.js"]

FROM base AS web-build
COPY . .
RUN npm run build:contracts && npm run build:web

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
