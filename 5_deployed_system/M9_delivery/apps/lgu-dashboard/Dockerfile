# Context: Monorepo Root (M9_delivery)
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy root configurations
COPY package.json bun.lockb ./

# Copy workspace package definitions to cache install
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/lgu-dashboard/package.json apps/lgu-dashboard/

# Install dependencies
RUN bun install

# Copy source code
COPY packages/ packages/
COPY apps/lgu-dashboard/ apps/lgu-dashboard/

# Build the app
RUN bun run --cwd apps/lgu-dashboard build

# Production Image
FROM nginx:alpine
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/lgu-dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
