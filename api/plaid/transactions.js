import { getStore, json } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const store = getStore();
  const latest = Array.from(store.transactionsById.values())
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.transactionId.localeCompare(a.transactionId);
    })
    .slice(0, 100);

  json(res, 200, {
    count: store.transactionsById.size,
    transactions: latest,
  });
}

