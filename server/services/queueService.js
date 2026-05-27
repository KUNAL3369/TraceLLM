import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { supabase } from "../db/supabase.js";
import { redactLogPayload } from "./piiRedaction.js";
import { trackUsage, checkUsageLimit } from "./usageService.js";

const REDIS_URL = process.env.REDIS_URL;

let connection = null;
let ingestQueue = null;
let ingestWorker = null;

function getConnection() {
  if (!REDIS_URL) return null;
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (!ingestQueue) {
    ingestQueue = new Queue("tracellm-ingest", { connection: conn });
  }
  return ingestQueue;
}

export async function enqueueIngest(payload) {
  const queue = getQueue();
  if (!queue) return null;

  const job = await queue.add("ingest-log", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 100,
  });
  return job.id;
}

export function startIngestWorker() {
  const conn = getConnection();
  if (!conn) {
    console.log("[Queue] Redis not configured — using direct ingestion");
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
        console.error("[Queue] Ingest worker error:", error);
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
    }
  );

  ingestWorker.on("failed", (job, err) => {
    console.error(`[Queue] Job ${job.id} failed after ${job.attemptsMade} attempts:`, err.message);
  });

  console.log("[Queue] Ingest worker started");
}

export async function shutdownQueue() {
  if (ingestWorker) await ingestWorker.close();
  if (ingestQueue) await ingestQueue.close();
  if (connection) await connection.quit();
}
