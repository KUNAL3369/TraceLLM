import { Router } from "express";
import { supabase } from "../db/supabase.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("project_id", req.query.project_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

export default router;
