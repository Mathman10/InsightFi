import { getAuthenticatedUser, getSupabaseAdmin, json } from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const user = await getAuthenticatedUser(req, res);
  if (!user) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const [{ error: txDeleteError }, { error: cursorResetError }, { count: itemCount }] = await Promise.all([
    supabase.from("plaid_transactions").delete().eq("user_id", user.id),
    supabase.from("plaid_items").update({ cursor: null }).eq("user_id", user.id),
    supabase.from("plaid_items").select("*", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  if (txDeleteError || cursorResetError) {
    json(res, 500, { error: txDeleteError?.message ?? cursorResetError?.message ?? "Reset failed" });
    return;
  }

  json(res, 200, { itemCount: itemCount ?? 0, count: 0 });
}
