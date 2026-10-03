import { API_BASE } from '../data/crossings'

const timeout = (ms) => AbortSignal.timeout(ms)

// Resolve a live snapshot URL from a JP ipcamlive alias (server-side).
// Returns { online: boolean, snapshotUrl: string|null }.
export async function fetchSnapshotUrl(alias) {
  const res = await fetch(`${API_BASE}/snapshot-url?alias=${alias}`, { signal: timeout(12000) })
  if (!res.ok) throw new Error(`snapshot-url ${res.status}`)
  return res.json()
}

// Fetch the actual image bytes (base64) for a snapshot URL, server-side (no CORS).
// Returns { base64: string, mediaType: string }.
export async function fetchSnapshotImage(url) {
  const res = await fetch(`${API_BASE}/snapshot-image?url=${encodeURIComponent(url)}`, {
    signal: timeout(15000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `snapshot-image ${res.status}`)
  }
  return res.json()
}

// Ask Claude Sonnet Vision to analyze a snapshot. Returns a detection:
// { train_present, crossing_blocked, direction, speed_estimate_mph, gates_down, confidence, notes }.
export async function analyzeVision({ base64, mediaType, crossingId, crossingName }) {
  const res = await fetch(`${API_BASE}/analyze-vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mediaType, crossingId, crossingName }),
    signal: timeout(35000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `analyze-vision ${res.status}`)
  }
  return res.json()
}

// Send an email alert for an event at a crossing.
// eventType: "train_detected" | "train_cleared". Server enforces a 30-min cooldown;
// an error whose message includes "Cooldown" should be treated as a non-error.
export async function sendAlert({ email, crossingId, crossingName, eventType, direction, speed, eta, notes }) {
  const res = await fetch(`${API_BASE}/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, crossingId, crossingName, eventType, direction, speed, eta, notes }),
    signal: timeout(12000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `send-alert ${res.status}`)
  return body
}

// Fetch current corridor status (+ optional history) from the server.
// Returns { latest, history }. latest: { checkedAt, metairie, propagated, cameras }.
export async function fetchStatus({ history = false } = {}) {
  const res = await fetch(`${API_BASE}/status${history ? '?history=1' : ''}`, { signal: timeout(12000) })
  if (!res.ok) throw new Error(`status ${res.status}`)
  return res.json()
}