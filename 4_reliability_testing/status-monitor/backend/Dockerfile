FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json ./
RUN bun install

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]