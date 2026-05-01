import { createClient } from "@supabase/supabase-js";

const plaidEnv = (process.env.PLAID_ENV ?? "sandbox").trim();
const plaidClientId = (process.env.PLAID_CLIENT_ID ?? "").trim();
const plaidSecret = (process.env.PLAID_SECRET ?? "").trim();
const plaidDaysRequestedRaw = Number(process.env.PLAID_DAYS_REQUESTED ?? "365");
const plaidDaysRequested = Number.isFinite(plaidDaysRequestedRaw)
  ? Math.min(Math.max(Math.floor(plaidDaysRequestedRaw), 30), 730)
  : 365;
const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

const plaidBaseUrl =
  plaidEnv === "production"
    ? "https://production.plaid.com"
    : plaidEnv === "development"
      ? "https://development.plaid.com"
      : "https://sandbox.plaid.com";

function isPlaceholderValue(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.includes("your_") ||
    normalized.includes("actual_") ||
    normalized.includes("replace_me")
  );
}

export function plaidConfigured() {
  return !isPlaceholderValue(plaidClientId) && !isPlaceholderValue(plaidSecret);
}

export function getPlaidEnv() {
  return plaidEnv;
}
export function getPlaidDaysRequested() {
  return plaidDaysRequested;
}

export function json(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

export function supabaseConfigured() {
  return supabaseUrl.length > 0 && supabaseServiceRoleKey.length > 0;
}

export function getSupabaseAdmin() {
  if (!supabaseConfigured()) return null;
  const g = globalThis;
  if (!g.__supabaseAdminPlaid) {
    g.__supabaseAdminPlaid = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return g.__supabaseAdminPlaid;
}

export async function getAuthenticatedUser(req, res) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    json(res, 500, {
      error: "Supabase admin is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
    return null;
  }

  const authHeader = req.headers.authorization ?? req.headers.Authorization;
  const token =
    typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
  if (!token) {
    json(res, 401, { error: "Missing bearer token." });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    json(res, 401, { error: "Invalid auth token." });
    return null;
  }

  return data.user;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export async function callPlaid(path, body) {
  const response = await fetch(`${plaidBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: plaidClientId,
      secret: plaidSecret,
      ...body,
    }),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { error: "Plaid returned non-JSON response." };
  }

  return { response, data };
}
