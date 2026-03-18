FROM oven/bun:1.2.8 AS build
WORKDIR /app

COPY package.json ./
COPY bun.lock ./
RUN bun install

COPY . .
RUN bun run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
