import {
  callPlaid,
  getAuthenticatedUser,
  getSupabaseAdmin,
  json,
  plaidConfigured,
  readJsonBody,
} from "../../_lib.js";

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
    const supabase = getSupabaseAdmin();
    if (!supabase) return;

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

    const { error: upsertError } = await supabase.from("plaid_items").upsert(
      [
        {
          user_id: user.id,
          item_id: itemId,
          access_token: accessToken,
          linked_at: new Date().toISOString(),
        },
      ],
      { onConflict: "user_id,item_id" },
    );
    if (upsertError) {
      json(res, 500, { error: upsertError.message });
      return;
    }

    const { count } = await supabase
      .from("plaid_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    json(res, 200, {
      item_id: itemId,
      itemCount: count ?? 0,
    });
  } catch (error) {
    json(res, 500, {
      error: "Unexpected error exchanging Plaid token",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
