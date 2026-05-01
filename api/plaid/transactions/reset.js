import { getStore, json } from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const store = getStore();
  store.transactionsById.clear();
  store.items = store.items.map((item) => ({ ...item, cursor: undefined }));

  json(res, 200, {
    itemCount: store.items.length,
    count: store.transactionsById.size,
  });
}

