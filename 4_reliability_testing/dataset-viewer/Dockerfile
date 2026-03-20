# Stage 1: Build the React frontend
FROM oven/bun:1 AS frontend-build

WORKDIR /frontend

COPY frontend/package.json ./
RUN bun install

COPY frontend/ ./
RUN bun run build

# Stage 2: Bun backend + built frontend assets in one container
FROM oven/bun:1 AS runtime

WORKDIR /app

COPY backend/package.json ./
RUN bun install

COPY backend/tsconfig.json ./
COPY backend/src ./src

# Copy the built frontend so Bun can serve it as static files
COPY --from=frontend-build /frontend/dist ./dist

ENV DIST_DIR=./dist

EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
