import {
  getAuthenticatedUser,
  getPlaidDaysRequested,
  getPlaidEnv,
  getSupabaseAdmin,
  json,
  plaidConfigured,
} from "./_lib.js";

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req, res);
  if (!user) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const [{ count: itemCount }, { count: syncedTransactionCount }] = await Promise.all([
    supabase.from("plaid_items").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("plaid_transactions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  json(res, 200, {
    configured: plaidConfigured(),
    env: getPlaidEnv(),
    daysRequested: getPlaidDaysRequested(),
    itemCount: itemCount ?? 0,
    syncedTransactionCount: syncedTransactionCount ?? 0,
    needsEnv: !plaidConfigured(),
  });
}
