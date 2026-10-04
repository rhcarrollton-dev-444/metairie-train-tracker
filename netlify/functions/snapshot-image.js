// netlify/functions/snapshot-image.js
// Fetches a snapshot image from ipcamlive CDN and returns it as base64.
// This runs server-side so there are no CORS issues fetching from ipcamlive servers.

import { jsonResponse, preflight } from "./_cors.js";

const ALLOWED_HOSTS = [
  "ipcamlive.com",
  ".ipcamlive.com",
];

function isAllowedUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ALLOWED_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(h)
    );
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  const pf = preflight(event);
  if (pf) return pf;

  const imageUrl = event.queryStringParameters?.url;

  if (!imageUrl) {
    return jsonResponse({ error: "Missing url parameter" }, { status: 400 });
  }

  if (!isAllowedUrl(imageUrl)) {
    return jsonResponse({ error: "URL not in allowlist" }, { status: 403 });
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MetairieTrainTracker/1.0)",
        "Referer": "https://www.jeffparish.gov/676/Rail-Cameras",
        "Accept": "image/jpeg,image/*,*/*",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return jsonResponse({ error: `Upstream returned ${res.status}` }, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    if (buffer.byteLength < 500) {
      return jsonResponse({ error: "Image too small — camera may be offline" }, { status: 502 });
    }

    // Convert to base64
    const base64 = Buffer.from(buffer).toString("base64");

    return jsonResponse(
      {
        base64,
        mediaType: contentType.split(";")[0].trim(),
        sizeBytes: buffer.byteLength,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, { status: 502 });
  }
};