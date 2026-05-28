import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
    : undefined,
  serializers: {
    req: (r) => ({
      id: r.id,
      method: r.method,
      url: r.url,
      userId: r.userId,
    }),
    res: (r) => ({
      statusCode: r.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info({
      type: "request",
      req: { id: req.id, method: req.method, url: req.originalUrl, userId: req.userId },
      res: { statusCode: res.statusCode },
      duration_ms: duration,
    });
  });
  next();
}
