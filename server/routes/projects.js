import { Router } from "express";
import { supabase } from "../db/supabase.js";
import crypto from "crypto";
import { z } from "zod";
import { logger } from "../services/logger.js";

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
});

function generateApiKey() {
  const raw = `tracellm_${crypto.randomBytes(32).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function getUserOrgQuery(userId) {
  return supabase
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId)
    .single();
}

router.get("/", async (req, res) => {
  try {
    const { data: org } = await getUserOrgQuery(req.userId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const { data: projects, error } = await supabase
      .from("projects")
      .select(
        "*, api_keys(id, label, status, created_at, last_used_at, key_hash)",
      )
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const masked = projects.map((p) => ({
      ...p,
      api_keys: p.api_keys.map((k) => ({
        ...k,
        key_preview: k.key_hash ? `${k.key_hash.slice(0, 8)}...` : null,
      })),
    }));

    return res.json(masked);
  } catch (err) {
    logger.error({ err }, "Projects list error");
    return res.status(500).json({ error: "Failed to list projects" });
  }
});

router.post("/", async (req, res) => {
  try {
    const parsed = createProjectSchema.parse(req.body);
    const { data: org } = await getUserOrgQuery(req.userId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        organization_id: org.id,
        name: parsed.name,
        environment: parsed.environment,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const { raw, hash } = generateApiKey();
    const { error: keyError } = await supabase
      .from("api_keys")
      .insert({ project_id: project.id, key_hash: hash, label: "default" });

    if (keyError) return res.status(500).json({ error: keyError.message });

    return res.status(201).json({ ...project, api_key: raw });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: err.errors });
    }
    logger.error({ err }, "Create project error");
    return res.status(500).json({ error: "Failed to create project" });
  }
});

router.post("/:id/keys", async (req, res) => {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("id, organization_id")
      .eq("id", req.params.id)
      .single();

    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", project.organization_id)
      .eq("owner_user_id", req.userId)
      .single();

    if (!org) return res.status(403).json({ error: "Not authorized" });

    const { raw, hash } = generateApiKey();
    const { data: key, error } = await supabase
      .from("api_keys")
      .insert({
        project_id: project.id,
        key_hash: hash,
        label: req.body.label || "default",
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ ...key, raw_key: raw });
  } catch (err) {
    logger.error({ err }, "Create key error");
    return res.status(500).json({ error: "Failed to create key" });
  }
});

router.patch("/:projectId/keys/:keyId/revoke", async (req, res) => {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("id, organization_id")
      .eq("id", req.params.projectId)
      .single();

    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", project.organization_id)
      .eq("owner_user_id", req.userId)
      .single();

    if (!org) return res.status(403).json({ error: "Not authorized" });

    const { error } = await supabase
      .from("api_keys")
      .update({ status: "revoked" })
      .eq("id", req.params.keyId)
      .eq("project_id", req.params.projectId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Revoke key error");
    return res.status(500).json({ error: "Failed to revoke key" });
  }
});

export default router;
