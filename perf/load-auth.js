// k6 load profile for the auth endpoint — exercises throttling +
// password verification under concurrency.
//
//   k6 run perf/load-auth.js
//
// Stages ramp 0→50 VUs over 1 minute, hold 1 minute, then ramp down.
// Adjust BASE_URL / TEST_EMAIL / TEST_PASSWORD env vars for staging.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:4000'
const EMAIL = __ENV.TEST_EMAIL || 'load-test@example.com'
const PASSWORD = __ENV.TEST_PASSWORD || 'IntentionallyWrong!1'

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m',  target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Auth endpoints are throttled — assert correctness over latency.
    http_req_failed:   ['rate<0.05'],
    'http_req_duration{endpoint:login}': ['p(95)<800'],
  },
}

export default function () {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login' },
    },
  )

  check(res, {
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'never crashes (5xx)':  (r) => r.status < 500,
  })

  sleep(1)
}
