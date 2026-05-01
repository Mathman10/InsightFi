import {
  callPlaid,
  getAuthenticatedUser,
  getPlaidDaysRequested,
  json,
  plaidConfigured,
  readJsonBody,
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

  try {
    const user = await getAuthenticatedUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const clientUserId =
      typeof body.client_user_id === "string" && body.client_user_id.trim().length > 0
        ? body.client_user_id.trim()
        : user.id;
    const requestedDaysRaw =
      typeof body.days_requested === "number"
        ? body.days_requested
        : Number(body.days_requested ?? getPlaidDaysRequested());
    const requestedDays = Number.isFinite(requestedDaysRaw)
      ? Math.min(Math.max(Math.floor(requestedDaysRaw), 30), 730)
      : getPlaidDaysRequested();

    const { response, data } = await callPlaid("/link/token/create", {
      client_name: "Insight Financial",
      country_codes: ["US"],
      language: "en",
      user: { client_user_id: clientUserId },
      products: ["transactions"],
      transactions: { days_requested: requestedDays },
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
