# API reference

The HTTP API is documented with [Redoc](https://redoc.ly/) from the OpenAPI
spec emitted by the NestJS backend at `/api/openapi.json`.

## Live reference

When the backend is running locally:

- Swagger UI: <http://localhost:4000/api/docs>
- OpenAPI JSON: <http://localhost:4000/api/openapi.json>
- Redoc static page: build with `npm run docs:redoc` (output: `dist/redoc.html`)

## Building the static Redoc page in CI

The CI workflow:

1. boots the backend with `NODE_ENV=test`
2. curls the OpenAPI JSON to `backend/openapi.json`
3. runs `npx redoc-cli bundle backend/openapi.json -o site/api/index.html`
4. publishes it alongside the MkDocs site

## Top-level resource map

| Resource         | Prefix                 |
| ---------------- | ---------------------- |
| Authentication   | `/api/auth/*`          |
| Claims           | `/api/claims/*`        |
| Documents        | `/api/documents/*`     |
| Providers        | `/api/providers/*`     |
| Appeals          | `/api/appeals/*`       |
| Batch submission | `/api/batches/*`       |
| Reports          | `/api/reports/*`       |
| Activity logs    | `/api/activity-logs/*` |
| Webhooks         | `/api/webhooks/*`      |
