# Context: Monorepo Root (M9_delivery)
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy root configurations
COPY package.json bun.lock* ./

# Copy workspace package definitions to cache install
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/admin-console/package.json apps/admin-console/

# Install dependencies
RUN bun install

# Copy source code
COPY packages/ packages/
COPY apps/admin-console apps/admin-console

# Build the app
RUN bun run --cwd apps/admin-console build

# Production Image
FROM nginx:alpine
# Forward unknown routes to index.html for Single Page Application routing (React Router etc if added later)
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/admin-console/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
