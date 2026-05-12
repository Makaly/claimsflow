// k6 smoke test — sanity-check that the API responds and core endpoints
// are reachable. Run with:
//   k6 run perf/smoke.js
//
// Thresholds are strict for the smoke variant because traffic is tiny —
// any slowness here means something is wrong before we even reach load.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:4000'

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // <1% errors
    http_req_duration: ['p(95)<500'],   // 95% under 500ms
  },
}

export default function () {
  const res = http.get(`${BASE}/api/health`)
  check(res, {
    'health 200':        (r) => r.status === 200,
    'health body is ok': (r) => r.json('status') === 'ok',
  })
  sleep(1)
}
