import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const isProd = process.env.NODE_ENV === "production";

export function startTelemetry() {
  if (!process.env.OTEL_ENABLED && !isProd) return;

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

  process.on("SIGTERM", () => {
    sdk
      .shutdown()
      .catch((err) =>
        process.stderr.write(`Telemetry shutdown error: ${err}\n`),
      );
  });
}
