import { getAuthenticatedUser, getSupabaseAdmin, json } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const user = await getAuthenticatedUser(req, res);
  if (!user) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { data, error } = await supabase
    .from("plaid_transactions")
    .select(
      "transaction_id,item_id,account_id,account_name,amount,date,name,merchant_name,pending",
    )
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(100);
  if (error) {
    json(res, 500, { error: error.message });
    return;
  }

  const latest = (data ?? []).map((row) => ({
    transactionId: row.transaction_id,
    itemId: row.item_id,
    accountId: row.account_id,
    accountName: row.account_name ?? undefined,
    amount: row.amount,
    date: row.date,
    name: row.name,
    merchantName: row.merchant_name ?? undefined,
    pending: Boolean(row.pending),
  }));

  json(res, 200, {
    count: latest.length,
    transactions: latest,
  });
}
