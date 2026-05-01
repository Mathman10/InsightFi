import { callPlaid, json, plaidConfigured, readJsonBody } from "../_lib.js";

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
    const clientUserId =
      typeof body.client_user_id === "string" && body.client_user_id.trim().length > 0
        ? body.client_user_id.trim()
        : `vercel-user-${Date.now()}`;

    const { response, data } = await callPlaid("/link/token/create", {
      client_name: "Insight Financial",
      country_codes: ["US"],
      language: "en",
      user: { client_user_id: clientUserId },
      products: ["transactions"],
    });

    if (!response.ok || !data.link_token) {
      json(res, response.status || 500, {
        error: "Failed to create Plaid link token",
        plaidError: data,
      });
      return;
    }

    json(res, 200, {
      link_token: data.link_token,
      expiration: data.expiration,
    });
  } catch (error) {
    json(res, 500, {
      error: "Unexpected error creating Plaid link token",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

