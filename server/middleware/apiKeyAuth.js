import crypto from "crypto";
import { supabase } from "../db/supabase.js";

export async function apiKeyAuth(req, res, next) {
  const header = req.headers["authorization"] || req.headers["x-api-key"];
  if (!header) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const apiKey = header.startsWith("Bearer ") ? header.slice(7) : header;
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

  const { data, error } = await supabase
    .from("api_keys")
    .select("project_id, status")
    .eq("key_hash", hash)
    .single();

  if (error || !data || data.status !== "active") {
    return res.status(401).json({ error: "Invalid or inactive API key" });
  }

  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", hash);

  req.projectId = data.project_id;
  next();
}

export async function userAuth(req, res, next) {
  const header = req.headers["authorization"];
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.query.token;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid auth token" });
  }

  req.userId = user.id;
  next();
}

export async function ingestAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  const header = authHeader || apiKeyHeader;

  if (header) {
    const candidate = header.startsWith("Bearer ") ? header.slice(7) : header;
    const hash = crypto.createHash("sha256").update(candidate).digest("hex");
    const { data, error } = await supabase
      .from("api_keys")
      .select("project_id, status")
      .eq("key_hash", hash)
      .single();

    if (!error && data && data.status === "active") {
      req.projectId = data.project_id;
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_hash", hash);
      return next();
    }
  }

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.query.token;
  if (token) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (!error && user) {
      req.userId = user.id;
      return next();
    }
  }

  return res.status(401).json({ error: "Missing or invalid authentication" });
}
