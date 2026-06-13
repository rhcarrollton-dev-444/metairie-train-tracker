// All network calls go through Netlify serverless functions.
// No API keys or cross-origin requests needed from the browser.

const BASE = "/.netlify/functions";

/**
 * Resolve the live snapshot URL for an ipcamlive alias.
 * Returns { online, snapshotUrl, streamUrl } or throws.
 */
export async function getSnapshotUrl(alias) {
  const res = await fetch(`${BASE}/snapshot-url?alias=${alias}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`snapshot-url ${res.status}`);
  return res.json();
}

/**
 * Fetch a snapshot image and return it as base64.
 * Returns { base64, mediaType, sizeBytes, fetchedAt } or throws.
 */
export async function getSnapshotImage(snapshotUrl) {
  const res = await fetch(
    `${BASE}/snapshot-image?url=${encodeURIComponent(snapshotUrl)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `snapshot-image ${res.status}`);
  }
  return res.json();
}

/**
 * Send a base64 image to Claude Vision via the server-side proxy.
 * Returns the structured detection object or throws.
 */
export async function analyzeVision({ base64, mediaType, crossingId, crossingName }) {
  const res = await fetch(`${BASE}/analyze-vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, mediaType, crossingId, crossingName }),
    signal: AbortSignal.timeout(35000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `analyze-vision ${res.status}`);
  }
  return res.json();
}
