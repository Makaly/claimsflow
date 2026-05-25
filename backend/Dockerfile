FROM node:26-alpine AS builder

WORKDIR /app

# Build-time deps: python/make/g++ for native addons, openssl for Prisma
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client targeting Alpine's musl + OpenSSL 3.x
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:26-alpine

WORKDIR /app

# Runtime dependencies
# - openssl: required by Prisma query engine on Alpine (musl)
# - tesseract-ocr: OCR fallback pipeline
# - poppler-utils: pdftoppm / pdftotext for per-page PDF processing
RUN apk add --no-cache openssl tesseract-ocr poppler-utils

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and Prisma artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Tesseract English language data (bundled in the repo root)
COPY eng.traineddata /usr/share/tessdata/eng.traineddata

EXPOSE 4000

# Run migrations then start the compiled application
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
