// All network calls go through Netlify serverless functions.
// No API keys or cross-origin requests needed from the browser.

const BASE = "/.netlify/functions";

export async function getSnapshotUrl(alias) {
  const res = await fetch(`${BASE}/snapshot-url?alias=${alias}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`snapshot-url ${res.status}`);
  return res.json();
}

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

export async function sendAlert({ email, crossingId, crossingName, eventType, direction, speed, eta, notes }) {
  const res = await fetch(`${BASE}/send-alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, crossingId, crossingName, eventType, direction, speed, eta, notes }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `send-alert ${res.status}`);
  return data;
}
