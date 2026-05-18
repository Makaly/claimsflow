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
| Scanner          | `/api/scanner/*`       |

## Scanner endpoints

All scanner endpoints require a valid JWT session cookie (`JwtAuthGuard`).

### `GET /api/scanner/devices`

Lists hardware scanners visible to the server process.

**Response**

```jsonc
{
  "devices": [
    {
      "id": "{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\\0000",
      "name": "Epson WorkForce DS-530 flatbed scanner",
      "vendor": "Epson",
      "model": "Epson WorkForce DS-530 flatbed scanner",
      "type": "flatbed"
    }
  ],
  "driverAvailable": true,       // false when scanimage / WIA COM is absent
  "platform": "linux"            // "linux" | "windows" | "other"
}
```

The `platform` field reflects the **server** OS. Use it to show the correct
driver installation instructions in the UI.

> **Note:** `saneAvailable` (legacy field) is no longer emitted. Clients should
> read `driverAvailable`, falling back to `saneAvailable` for compatibility with
> older cached responses.

### `POST /api/scanner/scan`

Triggers a single-page scan on the specified device and returns the result as
`application/pdf`.

**Request body**

| Field        | Type                               | Default   |
| ------------ | ---------------------------------- | --------- |
| `deviceId`   | `string` (required)                | —         |
| `resolution` | `75 \| 150 \| 300 \| 600`         | `300`     |
| `mode`       | `"Color" \| "Gray" \| "Lineart"`  | `"Color"` |

`deviceId` must be one of the IDs returned by `GET /api/scanner/devices` — any
unrecognised value is rejected with `400 Bad Request` before any shell command
is executed.

**Response** — `Content-Type: application/pdf` binary stream.
