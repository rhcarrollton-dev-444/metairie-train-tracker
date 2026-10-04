// Shared CORS handling for all functions.
// The Capacitor iOS WebView sends Origin: capacitor://localhost — without these
// headers the wrapped app is blocked from calling its own backend.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Standard JSON response builder with CORS applied.
export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...headers },
    body: JSON.stringify(data),
  };
}

// OPTIONS preflight handler — returns true (and the response) if this is a preflight.
export function preflight(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  return null;
}