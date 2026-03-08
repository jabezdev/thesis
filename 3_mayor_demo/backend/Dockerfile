FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --production

# Copy application files
COPY . .

# Expose port (must match server.ts)
EXPOSE 3001

# Run the server
CMD ["bun", "run", "server.ts"]
