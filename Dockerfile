FROM node:26-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public ./public/

# Create db directory
RUN mkdir -p db

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
