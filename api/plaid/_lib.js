const plaidEnv = (process.env.PLAID_ENV ?? "sandbox").trim();
const plaidClientId = (process.env.PLAID_CLIENT_ID ?? "").trim();
const plaidSecret = (process.env.PLAID_SECRET ?? "").trim();

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

export function json(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

export function getStore() {
  const g = globalThis;
  if (!g.__plaidStore) {
    g.__plaidStore = {
      items: [],
      transactionsById: new Map(),
    };
  }
  return g.__plaidStore;
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

