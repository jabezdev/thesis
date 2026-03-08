FROM node:22-alpine AS build

WORKDIR /app

# Copy package configuration
COPY package.json package-lock.json* ./

# Check if bun lock exists, although we use npm to be safe with standard vite react setups
RUN npm install

# Copy source code
COPY . .

# Build the project
RUN npm run build


FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
