# k6 performance suite

| File           | Profile  | Run                                     |
| -------------- | -------- | --------------------------------------- |
| `smoke.js`     | 1 VU, 20s | `k6 run perf/smoke.js`                 |
| `load-auth.js` | 0→50 VU ramp, 2 min total | `k6 run perf/load-auth.js` |

## Thresholds

| Metric                                | Smoke   | Load    |
| ------------------------------------- | ------- | ------- |
| `http_req_failed` rate                | < 1%    | < 5%    |
| `http_req_duration` p95               | < 500ms | (n/a)   |
| `http_req_duration{endpoint:login}` p95 | (n/a) | < 800ms |

## Environment variables

| Var             | Default                                | Purpose                       |
| --------------- | -------------------------------------- | ----------------------------- |
| `BASE_URL`      | `http://localhost:4000`                | Target backend                |
| `TEST_EMAIL`    | `load-test@example.com`                | Login probe credential        |
| `TEST_PASSWORD` | `IntentionallyWrong!1`                 | Same — kept invalid on purpose |

## CI

GitHub Actions runs `smoke.js` against an ephemeral backend boot. The load
profile is gated behind the `perf` label and runs only when explicitly
requested to avoid burning minutes on every push.
