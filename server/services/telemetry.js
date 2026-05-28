import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

const isProd = process.env.NODE_ENV === "production";

export function startTelemetry() {
  if (!process.env.OTEL_ENABLED && !isProd) return;

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: "tracellm-api",
      [SemanticResourceAttributes.SERVICE_VERSION]: "2.0.0",
    }),
    instrumentations: [
      ...getNodeAutoInstrumentations(),
      new ExpressInstrumentation(),
      new IORedisInstrumentation(),
    ],
    spanProcessors: [
      new SimpleSpanProcessor(new ConsoleSpanExporter()),
    ],
  });

  sdk.start();
  console.log("[Telemetry] OpenTelemetry started");

  process.on("SIGTERM", () => {
    sdk.shutdown().catch(console.error);
  });
}
