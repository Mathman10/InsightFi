import { callPlaid, getStore, json, plaidConfigured, readJsonBody } from "../../_lib.js";

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

  try {
    const body = await readJsonBody(req);
    const publicToken = typeof body.public_token === "string" ? body.public_token.trim() : "";
    if (!publicToken) {
      json(res, 400, { error: "Missing public_token" });
      return;
    }

    const { response, data } = await callPlaid("/item/public_token/exchange", {
      public_token: publicToken,
    });

    if (!response.ok) {
      json(res, response.status || 500, {
        error: "Failed to exchange Plaid public token",
        plaidError: data,
      });
      return;
    }

    const itemId = typeof data.item_id === "string" ? data.item_id : "";
    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    if (!itemId || !accessToken) {
      json(res, 500, { error: "Plaid exchange response missing item_id or access_token" });
      return;
    }

    const store = getStore();
    const existingIndex = store.items.findIndex((item) => item.itemId === itemId);
    if (existingIndex >= 0) {
      store.items[existingIndex] = {
        ...store.items[existingIndex],
        accessToken,
      };
    } else {
      store.items.push({
        itemId,
        accessToken,
        linkedAt: new Date().toISOString(),
      });
    }

    json(res, 200, {
      item_id: itemId,
      itemCount: store.items.length,
    });
  } catch (error) {
    json(res, 500, {
      error: "Unexpected error exchanging Plaid token",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

