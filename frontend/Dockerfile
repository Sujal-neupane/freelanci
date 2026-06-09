# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build Vite app
RUN npm run build

# Production stage
FROM nginx:alpine AS runner

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Add custom Nginx configuration for security headers and React Router
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Security Headers \
    add_header X-Frame-Options "SAMEORIGIN"; \
    add_header X-XSS-Protection "1; mode=block"; \
    add_header X-Content-Type-Options "nosniff"; \
    add_header Referrer-Policy "strict-origin-when-cross-origin"; \
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always; \
    \
    # React Router config (fallback to index.html) \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
