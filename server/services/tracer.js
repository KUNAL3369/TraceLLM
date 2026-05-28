/**
 * Load OpenTelemetry before any other module.
 * This must be imported FIRST — before express, before any instrumented module.
 */
import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

if (process.env.OTEL_ENABLED || isProd) {
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { HttpInstrumentation } =
    await import("@opentelemetry/instrumentation-http");
  const { ExpressInstrumentation } =
    await import("@opentelemetry/instrumentation-express");
  const { IORedisInstrumentation } =
    await import("@opentelemetry/instrumentation-ioredis");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } =
    await import("@opentelemetry/semantic-conventions");
  const { ConsoleSpanExporter, SimpleSpanProcessor } =
    await import("@opentelemetry/sdk-trace-base");

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "tracellm-api",
      [ATTR_SERVICE_VERSION]: "2.0.0",
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new IORedisInstrumentation(),
    ],
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });

  sdk.start();
  process.stderr.write("[Telemetry] OpenTelemetry started\n");
}
