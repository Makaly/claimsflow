import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

// Bootstrap must be called before NestFactory.create so instrumentation patches
// are applied before any require() for http/pg/redis fires.
export function bootstrapTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'claimsflow-backend';

  if (!endpoint) {
    // Telemetry is opt-in; skip silently in local dev when no collector is configured.
    console.log('[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT not set — skipping OTLP bootstrap');
    return;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'production',
  });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log(`[telemetry] OTLP tracing started → ${endpoint}`);

  // Metrics: named SLO histograms consumed by Grafana dashboards.
  // Bucket boundaries (ms) are tuned to the expected latency bands:
  //   claim_submit and ocr are network-bound; fraud_score is CPU-bound;
  //   claim_cycle_time spans days (stored as hours).
  const metricExporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const meter = metrics.getMeter(serviceName);

  // Exposed so application code can record observations.
  // TODO: import and call these from ClaimsService, OcrService, AnomalyService.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const claimSubmitHistogram = meter.createHistogram('claim_submit_p95', {
    description: 'End-to-end claim submission latency (ms). SLO: p95 < 3 000 ms.',
    unit: 'ms',
    boundaries: [100, 250, 500, 1_000, 2_000, 3_000, 5_000, 10_000],
  });

  const ocrHistogram = meter.createHistogram('ocr_p95', {
    description: 'OCR extraction latency per document (ms). SLO: p95 < 30 000 ms.',
    unit: 'ms',
    boundaries: [1_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000],
  });

  const fraudScoreHistogram = meter.createHistogram('fraud_score_p95', {
    description: 'Fraud anomaly scoring latency per claim (ms). SLO: p95 < 2 000 ms.',
    unit: 'ms',
    boundaries: [50, 100, 250, 500, 1_000, 2_000, 5_000],
  });

  const claimCycleHistogram = meter.createHistogram('claim_cycle_time', {
    description: 'Full claim lifecycle from submission to final decision (hours). SLO: p95 < 72 h.',
    unit: 'h',
    boundaries: [1, 4, 8, 24, 48, 72, 120, 240],
  });
  /* eslint-enable @typescript-eslint/no-unused-vars */

  process.on('SIGTERM', async () => {
    await sdk.shutdown();
    await meterProvider.shutdown();
  });
}
