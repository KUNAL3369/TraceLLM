import { Router } from "express";
import { supabase } from "../db/supabase.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    let query = supabase
      .from("conversations")
      .select("*, messages(count), inference_logs(provider, model, total_tokens)")
      .order("last_activity_at", { ascending: false });

    if (req.query.project_id) {
      query = query.eq("project_id", req.query.project_id);
    }
    if (req.query.status) {
      query = query.eq("status", req.query.status);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error("Conversations error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { project_id, session_id, title } = req.body;
    const { data, error } = await supabase
      .from("conversations")
      .insert({ project_id, session_id, user_identifier: title || null, status: "active" })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error("Create conversation error:", err);
    return res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { data: conv, error } = await supabase
      .from("conversations")
      .select("*, messages(*)")
      .eq("id", req.params.id)
      .single();

    if (error) return res.status(404).json({ error: "Conversation not found" });
    return res.json(conv);
  } catch (err) {
    console.error("Conversation detail error:", err);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

router.post("/:id/messages", async (req, res) => {
  try {
    const { role, content, token_count } = req.body;
    if (!role || !content) {
      return res.status(400).json({ error: "role and content are required" });
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: req.params.id,
        role,
        content_preview: content.slice(0, 500),
        token_count: token_count || 0,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase
      .from("conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", req.params.id);

    return res.status(201).json(data);
  } catch (err) {
    console.error("Create message error:", err);
    return res.status(500).json({ error: "Failed to save message" });
  }
});

export default router;
