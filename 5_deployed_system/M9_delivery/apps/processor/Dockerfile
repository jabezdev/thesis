# Context: Monorepo Root (M9_delivery)
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy root configurations
COPY package.json bun.lockb ./

# Copy workspace package definitions to cache install
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/processor/package.json apps/processor/

# Install dependencies
RUN bun install

# Copy source code
COPY packages/ packages/
COPY apps/processor/ apps/processor/

# Set working directory to processor for execution
WORKDIR /app/apps/processor

# Command
CMD ["bun", "run", "index.ts"]
