import { getPlaidDaysRequested, getPlaidEnv, getStore, json, plaidConfigured } from "./_lib.js";

export default async function handler(_req, res) {
  const store = getStore();
  json(res, 200, {
    configured: plaidConfigured(),
    env: getPlaidEnv(),
    daysRequested: getPlaidDaysRequested(),
    itemCount: store.items.length,
    syncedTransactionCount: store.transactionsById.size,
    needsEnv: !plaidConfigured(),
  });
}
