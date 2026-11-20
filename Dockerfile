FROM node:26-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN npm install -g pnpm@12.21.0

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy application files
COPY server.js ./
COPY public ./public/

# Create db directory
RUN mkdir -p db

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
