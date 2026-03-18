FROM oven/bun:1.2.8
WORKDIR /app

COPY package.json ./
COPY bun.lock ./
RUN bun install

COPY tsconfig.json ./
COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/server.ts"]
