import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  process.stderr.write("Missing Supabase credentials in .env\n");
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
