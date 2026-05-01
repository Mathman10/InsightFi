import { callPlaid, getStore, json, plaidConfigured } from "../_lib.js";

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

  const store = getStore();
  if (store.items.length === 0) {
    json(res, 200, {
      itemCount: 0,
      count: store.transactionsById.size,
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
    for (const item of store.items) {
      let hasMore = true;
      let nextCursor = item.cursor ?? undefined;
      const accountNameById = new Map();

      const accountsResult = await callPlaid("/accounts/get", {
        access_token: item.accessToken,
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
          access_token: item.accessToken,
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

        for (const tx of addedRows) {
          if (!tx || typeof tx.transaction_id !== "string") continue;
          store.transactionsById.set(tx.transaction_id, {
            transactionId: tx.transaction_id,
            itemId: item.itemId,
            accountId: typeof tx.account_id === "string" ? tx.account_id : "",
            accountName:
              typeof tx.account_id === "string" ? accountNameById.get(tx.account_id) : undefined,
            amount: typeof tx.amount === "number" ? tx.amount : 0,
            date: typeof tx.date === "string" ? tx.date : "",
            name: typeof tx.name === "string" ? tx.name : "Plaid Transaction",
            merchantName:
              typeof tx.merchant_name === "string" ? tx.merchant_name : undefined,
            pending: Boolean(tx.pending),
          });
          added += 1;
        }

        for (const tx of modifiedRows) {
          if (!tx || typeof tx.transaction_id !== "string") continue;
          store.transactionsById.set(tx.transaction_id, {
            transactionId: tx.transaction_id,
            itemId: item.itemId,
            accountId: typeof tx.account_id === "string" ? tx.account_id : "",
            accountName:
              typeof tx.account_id === "string" ? accountNameById.get(tx.account_id) : undefined,
            amount: typeof tx.amount === "number" ? tx.amount : 0,
            date: typeof tx.date === "string" ? tx.date : "",
            name: typeof tx.name === "string" ? tx.name : "Plaid Transaction",
            merchantName:
              typeof tx.merchant_name === "string" ? tx.merchant_name : undefined,
            pending: Boolean(tx.pending),
          });
          modified += 1;
        }

        for (const tx of removedRows) {
          if (!tx || typeof tx.transaction_id !== "string") continue;
          if (store.transactionsById.delete(tx.transaction_id)) {
            removed += 1;
          }
        }

        nextCursor = typeof data.next_cursor === "string" ? data.next_cursor : nextCursor;
        hasMore = Boolean(data.has_more);
      }

      item.cursor = nextCursor;
    }

    const latest = Array.from(store.transactionsById.values())
      .sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return b.transactionId.localeCompare(a.transactionId);
      })
      .slice(0, 100);

    json(res, 200, {
      itemCount: store.items.length,
      count: store.transactionsById.size,
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

