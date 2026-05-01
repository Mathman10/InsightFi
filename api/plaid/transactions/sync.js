import {
  callPlaid,
  getAuthenticatedUser,
  getSupabaseAdmin,
  json,
  plaidConfigured,
} from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!plaidConfigured()) {
    json(res, 400, {
      error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.",
    });
    return;
  }

  const user = await getAuthenticatedUser(req, res);
  if (!user) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { data: userItems, error: itemsError } = await supabase
    .from("plaid_items")
    .select("item_id,access_token,cursor")
    .eq("user_id", user.id);
  if (itemsError) {
    json(res, 500, { error: itemsError.message });
    return;
  }
  if (!userItems || userItems.length === 0) {
    json(res, 200, {
      itemCount: 0,
      count: 0,
      added: 0,
      modified: 0,
      removed: 0,
      transactions: [],
    });
    return;
  }

  let added = 0;
  let modified = 0;
  let removed = 0;

  try {
    for (const item of userItems) {
      let hasMore = true;
      let nextCursor = item.cursor ?? undefined;
      const accountNameById = new Map();

      const accountsResult = await callPlaid("/accounts/get", {
        access_token: item.access_token,
      });
      if (accountsResult.response.ok && Array.isArray(accountsResult.data.accounts)) {
        for (const account of accountsResult.data.accounts) {
          if (account && typeof account.account_id === "string") {
            accountNameById.set(
              account.account_id,
              typeof account.name === "string" ? account.name : undefined,
            );
          }
        }
      }

      while (hasMore) {
        const { response, data } = await callPlaid("/transactions/sync", {
          access_token: item.access_token,
          cursor: nextCursor,
        });

        if (!response.ok) {
          json(res, response.status || 500, {
            error: "Failed to sync Plaid transactions",
            itemId: item.itemId,
            plaidError: data,
          });
          return;
        }

        const addedRows = Array.isArray(data.added) ? data.added : [];
        const modifiedRows = Array.isArray(data.modified) ? data.modified : [];
        const removedRows = Array.isArray(data.removed) ? data.removed : [];

        const upsertRows = [...addedRows, ...modifiedRows]
          .filter((tx) => tx && typeof tx.transaction_id === "string")
          .map((tx) => ({
            user_id: user.id,
            transaction_id: tx.transaction_id,
            item_id: item.item_id,
            account_id: typeof tx.account_id === "string" ? tx.account_id : "",
            account_name:
              typeof tx.account_id === "string" ? accountNameById.get(tx.account_id) ?? null : null,
            amount: typeof tx.amount === "number" ? tx.amount : 0,
            date: typeof tx.date === "string" ? tx.date : "",
            name: typeof tx.name === "string" ? tx.name : "Plaid Transaction",
            merchant_name: typeof tx.merchant_name === "string" ? tx.merchant_name : null,
            pending: Boolean(tx.pending),
          }));
        if (upsertRows.length > 0) {
          const { error: upsertError } = await supabase
            .from("plaid_transactions")
            .upsert(upsertRows, { onConflict: "user_id,transaction_id" });
          if (upsertError) {
            json(res, 500, { error: upsertError.message });
            return;
          }
        }
        added += addedRows.length;
        modified += modifiedRows.length;

        const removedIds = removedRows
          .filter((tx) => tx && typeof tx.transaction_id === "string")
          .map((tx) => tx.transaction_id);
        if (removedIds.length > 0) {
          const { error: removeError } = await supabase
            .from("plaid_transactions")
            .delete()
            .eq("user_id", user.id)
            .in("transaction_id", removedIds);
          if (removeError) {
            json(res, 500, { error: removeError.message });
            return;
          }
          removed += removedIds.length;
        }

        nextCursor = typeof data.next_cursor === "string" ? data.next_cursor : nextCursor;
        hasMore = Boolean(data.has_more);
      }

      const { error: cursorError } = await supabase
        .from("plaid_items")
        .update({ cursor: nextCursor ?? null })
        .eq("user_id", user.id)
        .eq("item_id", item.item_id);
      if (cursorError) {
        json(res, 500, { error: cursorError.message });
        return;
      }
    }

    const { data: latestRows, error: latestError } = await supabase
      .from("plaid_transactions")
      .select("transaction_id,item_id,account_id,account_name,amount,date,name,merchant_name,pending")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(100);
    if (latestError) {
      json(res, 500, { error: latestError.message });
      return;
    }

    const latest = (latestRows ?? []).map((row) => ({
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
      itemCount: userItems.length,
      count: latest.length,
      added,
      modified,
      removed,
      transactions: latest,
    });
  } catch (error) {
    json(res, 500, {
      error: "Unexpected error while syncing transactions",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
