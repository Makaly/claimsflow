# Deployment Guide

This document covers how to deploy the CIC Medical Claims frontend in both Docker and bare-server configurations.

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 20.x |
| npm | 9.x |
| Docker (optional) | 24.x |

---

## Building for Production

```bash
# 1. Install dependencies
npm ci

# 2. Set environment variables
cp .env.example .env
# Edit .env — set VITE_API_BASE_URL to the production API URL

# 3. Build
npm run build
```

The build outputs static files to `dist/`. These can be served by any web server (Nginx, Apache, Caddy, S3 + CloudFront, Netlify, Vercel, etc.).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Base URL of the backend REST API (e.g. `https://api.example.com`) |

> Variables prefixed with `VITE_` are inlined into the bundle at build time. Set them **before** running `npm run build`.

---

## Nginx (Recommended for Production)

Create a minimal Nginx configuration to serve the SPA and proxy API requests:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/cic-claims/dist;
    index index.html;

    # Serve static assets with long-lived cache
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Proxy API requests to the backend
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback — all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> The `try_files ... /index.html` line is **required** for client-side routing. Without it, direct page loads (e.g. refreshing `/claims`) will return 404.

---

## Docker

### Development

The included `Dockerfile` runs the Vite dev server with HMR:

```bash
docker build -t cic-claims-frontend .
docker run -p 3000:3000 --env-file .env cic-claims-frontend
```

### Production (Multi-Stage Build)

For production, use a multi-stage build to create a minimal Nginx image:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -f Dockerfile.prod -t cic-claims-frontend:prod .
docker run -p 80:80 cic-claims-frontend:prod
```

---

## Static Hosting (Netlify / Vercel / GitHub Pages)

For static hosting services:

1. Set `VITE_API_BASE_URL` in the platform's environment variable settings
2. Set the build command to `npm run build`
3. Set the publish directory to `dist`
4. Configure a rewrite rule: `/* → /index.html` (required for SPA routing)

**Netlify** (`netlify.toml`):
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

**Vercel** (`vercel.json`):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## Health Checks

The frontend itself is a static bundle — there is no server process to health check. Monitor the backend API endpoint instead.

For the Docker production image, you can add an Nginx health endpoint:

```nginx
location /health {
    return 200 "ok";
    add_header Content-Type text/plain;
}
```

---

## HTTPS / TLS

Always serve the application over HTTPS in production. Use Let's Encrypt with Certbot for free TLS certificates:

```bash
certbot --nginx -d your-domain.com
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Page refresh returns 404 | Missing SPA fallback | Add `try_files ... /index.html` to Nginx config |
| API calls fail with CORS errors | `VITE_API_BASE_URL` not set | Set the variable and rebuild |
| Blank page after deploy | Build used wrong env vars | Verify `.env` before `npm run build`; check the browser console |
| PDF.js worker 404 | Worker file missing from `dist` | Ensure `public/pdf.worker.min.js` is present before building |
