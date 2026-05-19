# Observability — ClaimsFlow Backend

## Overview

ClaimsFlow uses **OpenTelemetry** (OTLP) for distributed tracing and SLO metrics,
shipped to a collector (Grafana Agent / OpenTelemetry Collector) which forwards to
Grafana Cloud or a self-hosted Mimir + Tempo stack.

## Bootstrap

`backend/src/telemetry/telemetry.ts` is the first import in `main.ts`.
Auto-instrumentation patches `http`, `pg`, `redis`, `express`, and `nestjs` before
any module loads. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable; leave blank to skip.

## SLO Histograms

| Metric name         | Unit | SLO target   | Description                              |
|---------------------|------|--------------|------------------------------------------|
| `claim_submit_p95`  | ms   | p95 < 3 000  | End-to-end claim submission latency      |
| `ocr_p95`           | ms   | p95 < 30 000 | OCR extraction latency per document      |
| `fraud_score_p95`   | ms   | p95 < 2 000  | Fraud/anomaly scoring latency per claim  |
| `claim_cycle_time`  | h    | p95 < 72 h   | Submission → final decision lifecycle   |

## Grafana Wiring

1. Deploy [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) alongside the backend.
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` in the backend environment.
3. Configure the collector to forward metrics to Mimir and traces to Tempo.
4. Import the `ClaimsFlow SLO` Grafana dashboard (TODO: export JSON from Grafana and commit under `docs/grafana/`).

## Recording observations in application code

```typescript
// TODO: import histogram from telemetry module when instrumenting services.
// Example (ClaimsService.submit):
//   const start = Date.now();
//   await this.prisma.claim.create({ ... });
//   claimSubmitHistogram.record(Date.now() - start, { provider_type: claim.provider.type });
```

## Alert rules (example — PromQL)

```promql
# Breach when p95 submission latency > 3 s over 5 min window
histogram_quantile(0.95, sum(rate(claim_submit_p95_bucket[5m])) by (le)) > 3000
```
