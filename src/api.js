/**
 * API helpers — all calls go through Netlify functions, never direct from browser
 */

const BASE = '/.netlify/functions'

/**
 * Get the live snapshot URL for an ipcamlive camera alias
 */
export async function getSnapshotUrl(alias) {
  const res = await fetch(`${BASE}/snapshot-url?alias=${encodeURIComponent(alias)}`)
  if (!res.ok) throw new Error(`snapshot-url failed: ${res.status}`)
  const data = await res.json()
  return data.snapshotUrl
}

/**
 * Fetch a snapshot image and return as base64
 */
export async function getSnapshotBase64(snapshotUrl) {
  const res = await fetch(`${BASE}/snapshot-image?url=${encodeURIComponent(snapshotUrl)}`)
  if (!res.ok) throw new Error(`snapshot-image failed: ${res.status}`)
  const data = await res.json()
  return data.base64 // data:image/jpeg;base64,...
}

/**
 * Send image to Claude Vision for train detection analysis
 */
export async function analyzeSnapshot(base64Image) {
  const res = await fetch(`${BASE}/analyze-vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`analyze-vision failed: ${res.status} — ${err}`)
  }
  return await res.json()
  // Returns: { train_present, confidence, direction, speed_estimate_mph, gates_down, notes }
}

/**
 * Full pipeline: alias → snapshot URL → base64 → vision analysis
 */
export async function runDetectionPipeline(alias) {
  const snapshotUrl = await getSnapshotUrl(alias)
  const base64 = await getSnapshotBase64(snapshotUrl)
  const analysis = await analyzeSnapshot(base64)
  return { snapshotUrl, base64, analysis }
}
