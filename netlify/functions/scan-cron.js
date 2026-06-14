// netlify/functions/scan-cron.js
// Scheduled function — runs on a cron schedule (set in netlify.toml).
// Scans EVERY Jefferson Parish rail camera each cycle with Claude Haiku Vision,
// logs every timestamped detection to history (for cross-camera pattern analysis),
// and propagates corridor ETAs from the Metairie Rd camera only.
// The browser app reads the result via status.js for an instant answer on load.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_SPEED = 15;

// Corridor crossings predicted from the Metairie Rd camera (miles west of it).
const CORRIDOR = [
  { id: "labarre",   name: "Labarre Rd",   dist: -1.05 },
  { id: "atherton",  name: "Atherton Dr",  dist: -0.72 },
  { id: "hollywood", name: "Hollywood Dr", dist: -0.42 },
  { id: "farnham",   name: "Farnham Pl",   dist: -0.18 },
];

// Every camera we scan. "metairie" is the corridor anchor; the rest are watch
// cameras we collect data on without assuming how they connect to the corridor.
const CAMERAS = [
  { id: "metairie",    name: "Metairie Rd",       alias: "62fa4c1fb9f5c", corridor: true },
  { id: "littlefarms", name: "Little Farms Ave",  alias: "62b47da483e1f" },
  { id: "central",     name: "Central Ave",       alias: "63609c3400e64" },
  { id: "avondale",    name: "Avondale Garden Rd",alias: "635c0abb11126" },
  { id: "filmore",     name: "Filmore St",        alias: "6529556348194" },
  { id: "george",      name: "George St",         alias: "635c0c64414c1" },
  { id: "liveoak",     name: "Live Oak Blvd",     alias: "635c1059a967e" },
  { id: "willswood",   name: "Willswood Ln",      alias: "635c112681056" },
];

const VISION_PROMPT = `You are a train detection system analyzing a live railroad crossing camera image from Jefferson Parish, Louisiana. The image may be low resolution — that is fine, you only need to determine if a train is present.

Respond ONLY with a valid JSON object, no markdown or extra text:

{
  "train_present": boolean,
  "confidence": number (0.0-1.0),
  "crossing_blocked": boolean,
  "direction": "eastbound" | "westbound" | "stopped" | "none",
  "speed_estimate_mph": number | null,
  "gates_down": boolean | null,
  "notes": string (max 80 chars)
}

Rules:
- train_present: true if any railcar/locomotive is visible OR gates are down
- crossing_blocked: true only if train cars physically block the road crossing
- direction: best guess from motion blur or car position; "none" if no train
- If dark/unclear: train_present false, confidence 0.3, direction "none"`;

// Corridor propagation from the Metairie Rd detection.
function propagate(detection) {
  if (!detection.train_present || !detection.direction || detection.direction === "none") return {};
  if (detection.direction === "stopped") return {};
  const speed = detection.speed_estimate_mph || DEFAULT_SPEED;
  const out = {};
  for (const c of CORRIDOR) {
    if (detection.direction === "westbound") {
      out[c.id] = {
        mode: "approaching",
        eta_mins: (60 / speed) * Math.abs(c.dist),
        direction: "westbound", speed_mph: speed,
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.1),
        sourceName: "Metairie Rd", distMiles: Math.abs(c.dist),
      };
    } else if (detection.direction === "eastbound") {
      out[c.id] = {
        mode: "clearing",
        eta_mins: null,
        direction: "eastbound", speed_mph: speed,
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.2),
        sourceName: "Metairie Rd", distMiles: Math.abs(c.dist),
      };
    }
  }
  return out;
}

// Scan a single camera: resolve snapshot → fetch image → Claude Vision → detection.
async function scanCamera(cam, apiKey) {
  const stateRes = await fetch(`https://ipcamlive.com/player/getcamerastreamstate.php?alias=${cam.alias}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.jeffparish.gov/676/Rail-Cameras" },
    signal: AbortSignal.timeout(10000),
  });
  const stateData = await stateRes.json();
  if (!stateData?.details?.address || !stateData?.details?.streamid) {
    return { online: false };
  }
  const snapshotUrl = `${stateData.details.address}streams/${stateData.details.streamid}/snapshot.jpg`;

  const imgRes = await fetch(snapshotUrl, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.jeffparish.gov/676/Rail-Cameras" },
    signal: AbortSignal.timeout(12000),
  });
  if (!imgRes.ok) throw new Error(`snapshot ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  if (buffer.byteLength < 500) throw new Error("snapshot too small");

  const base64 = buffer.toString("base64");
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: VISION_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: "Is there a train at this crossing?" },
        ],
      }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const aiData = await aiRes.json();
  if (!aiRes.ok) throw new Error(aiData?.error?.message || "Anthropic error");
  const txt = aiData.content?.find(b => b.type === "text")?.text || "";
  const detection = JSON.parse(txt.replace(/```json|```/g, "").trim());
  return { online: true, detection };
}

export default async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response("No API key", { status: 500 });

  const store = getStore("rail-status");
  const now = Date.now();

  // Load history once, append all this cycle's detections, write once.
  let history = [];
  try { history = (await store.get("history", { type: "json" })) || []; } catch {}

  const cameras = {};      // id → detection (or offline marker)
  let metairieDetection = null;

  // Scan ALL cameras in parallel — sequential was timing out (~15s for 8 cameras).
  // Promise.allSettled means one slow/failing camera can't break the others.
  const results = await Promise.allSettled(
    CAMERAS.map(cam => scanCamera(cam, apiKey).then(res => ({ cam, res })))
  );

  for (const r of results) {
    if (r.status === "rejected") continue; // scanCamera threw before returning a cam ref
    const { cam, res } = r.value;
    if (!res.online) {
      cameras[cam.id] = { online: false, checkedAt: now };
      continue;
    }
    const det = res.detection;
    cameras[cam.id] = { online: true, checkedAt: now, ...det };
    if (cam.corridor) metairieDetection = det;

    // Log every detection (train or clear) for pattern analysis
    history.unshift({
      ts: now,
      crossingId: cam.id,
      crossingName: cam.name,
      train_present: det.train_present,
      direction: det.direction,
      speed_estimate_mph: det.speed_estimate_mph,
      confidence: det.confidence,
      notes: det.notes,
    });
  }

  const propagated = metairieDetection ? propagate(metairieDetection) : {};

  const status = {
    online: true,
    checkedAt: now,
    metairie: metairieDetection,   // back-compat: app reads .metairie for the hero
    cameras,                        // NEW: every camera's latest detection
    propagated,
    model: MODEL,
  };

  try { await store.setJSON("latest", status); } catch {}
  try { await store.setJSON("history", history.slice(0, 12000)); } catch {}

  const trainsNow = Object.values(cameras).filter(c => c.train_present).length;
  console.log(`Scan complete: ${trainsNow} camera(s) showing a train`);
  return new Response(JSON.stringify({ ok: true, trainsNow }), {
    headers: { "Content-Type": "application/json" },
  });
};

// Every 5 min, 5am–11pm Central (≈ 11:00–05:00 UTC). 8 cameras/scan.
export const config = {
  schedule: "*/5 11-23,0-5 * * *",
};
