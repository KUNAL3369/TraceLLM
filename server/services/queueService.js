import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { supabase } from "../db/supabase.js";
import { redactLogPayload } from "./piiRedaction.js";
import { trackUsage } from "./usageService.js";
import { logger } from "./logger.js";
import { updateQueueMetrics } from "../routes/internal.js";

const REDIS_URL = process.env.REDIS_URL;

let connection = null;
let ingestQueue = null;
let ingestWorker = null;
let dlq = null;

function getConnection() {
  if (!REDIS_URL) return null;
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
  }
  return connection;
}

export function getQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (!ingestQueue) {
    ingestQueue = new Queue("tracellm-ingest", {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 100,
      },
    });
    dlq = new Queue("tracellm-dlq", { connection: conn });
  }
  return ingestQueue;
}

export async function enqueueIngest(payload) {
  const queue = getQueue();
  if (!queue) return null;

  const jitter = Math.random() * 1000;
  const job = await queue.add("ingest-log", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 + jitter },
    removeOnComplete: 1000,
    removeOnFail: 100,
  });
  return job.id;
}

export function startIngestWorker() {
  const conn = getConnection();
  if (!conn) {
    logger.info("[Queue] Redis not configured — using direct ingestion");
    return;
  }

  if (ingestWorker) return;

  ingestWorker = new Worker(
    "tracellm-ingest",
    async (job) => {
      const { data: project } = await supabase
        .from("projects")
        .select("pii_redaction_enabled")
        .eq("id", job.data.project_id)
        .single();

      let payload = { ...job.data };
      if (project?.pii_redaction_enabled) {
        payload = redactLogPayload(payload);
      }

      const { error } = await supabase.from("inference_logs").insert(payload);

      if (error) {
        logger.error(
          { err: error, jobId: job.id },
          "[Queue] Ingest worker DB error",
        );
        throw error;
      }

      await trackUsage({
        projectId: payload.project_id,
        tokenCount: payload.total_tokens || 0,
      });
    },
    {
      connection: conn,
      concurrency: 5,
      limiter: { max: 50, duration: 1000 },
    },
  );

  ingestWorker.on("failed", async (job, err) => {
    logger.error(
      { jobId: job.id, attempts: job.attemptsMade, error: err.message },
      "[Queue] Job failed",
    );

    // Move to DLQ after all retries exhausted
    if (job.attemptsMade >= 3 && dlq) {
      await dlq.add("dead-letter", job.data, {
        jobId: job.id,
        attempts: 1,
        removeOnComplete: 1,
        removeOnFail: 1,
      });
      logger.info({ jobId: job.id }, "[Queue] Moved to dead-letter queue");
    }
  });

  ingestWorker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "[Queue] Job completed");
  });

  // poll queue metrics every 10s
  setInterval(async () => {
    if (!ingestQueue) return;
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        ingestQueue.getWaitingCount(),
        ingestQueue.getActiveCount(),
        ingestQueue.getCompletedCount(),
        ingestQueue.getFailedCount(),
        ingestQueue.getDelayedCount(),
      ]);
      updateQueueMetrics({ waiting, active, completed, failed, delayed });
    } catch {
      logger.warn("[Queue] Metrics poll failed");
    }
  }, 10000);

  logger.info("[Queue] Ingest worker started");
}

export async function shutdownQueue() {
  logger.info("[Queue] Shutting down...");
  if (ingestWorker) {
    await ingestWorker.close(true);
    logger.info("[Queue] Worker closed");
  }
  if (ingestQueue) {
    await ingestQueue.close();
    logger.info("[Queue] Queue closed");
  }
  if (dlq) {
    await dlq.close();
    logger.info("[Queue] DLQ closed");
  }
  if (connection) {
    await connection.quit();
    logger.info("[Queue] Redis connection closed");
  }
}
