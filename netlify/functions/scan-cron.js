// netlify/functions/scan-cron.js
// Scheduled function — runs on a cron schedule (see `config` at the bottom).
// Scans EVERY Jefferson Parish rail camera each cycle with Claude Haiku Vision,
// logs every timestamped detection to history (for cross-camera pattern analysis),
// and propagates corridor ETAs from BOTH corridor cameras (Metairie Rd + Labarre Rd).
// Westbound trains propagate through the Labarre junction onto the CN McComb chain.
// The browser app reads the result via status.js for an instant answer on load.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_SPEED = 15;

// Corridor crossings (NS Back Belt), distFromMetairie in OSM-measured track miles
// (negative = west of Metairie Rd). Mirrors src/data/crossings.js.
const CORRIDOR = [
  { id: "labarre",   name: "Labarre Rd",   dist: -1.462 },
  { id: "atherton",  name: "Atherton Dr",  dist: -1.065 },
  { id: "hollywood", name: "Hollywood Dr", dist: -0.821 },
  { id: "farnham",   name: "Farnham Pl",   dist: -0.307 },
  { id: "metairie",  name: "Metairie Rd",  dist: 0 },
];

// CN McComb crossings west of the Labarre junction (29.97075, -90.16399).
// Westbound trains continue onto these. [OSM_REFINEMENT_NEEDED: estimated distances]
const CN_CHAIN = [
  { id: "littlefarms", name: "Little Farms Ave", dist: -3.5 },
  { id: "central",     name: "Central Ave",      dist: -4.8 },
  { id: "filmore",     name: "Filmore St",       dist: -5.5 },
  { id: "george",      name: "George St",        dist: -5.9 },
];

// Every camera we scan. Corridor cameras anchor propagation; the rest are watch
// cameras we collect data on. Aliases verified against the JP parish camera page.
const CAMERAS = [
  { id: "metairie",    name: "Metairie Rd",        alias: "62fa4c1fb9f5c", corridor: true },
  { id: "labarre",     name: "Labarre Rd",         alias: "6aaae2ff5b5bc", corridor: true },
  { id: "littlefarms", name: "Little Farms Ave",   alias: "62b47da483e1f" },
  { id: "central",     name: "Central Ave",        alias: "63609c3400e64" },
  { id: "avondale",    name: "Avondale Garden Rd", alias: "635c0abb11126" },
  { id: "filmore",     name: "Filmore St",         alias: "6529556348194" },
  { id: "george",      name: "George St",          alias: "635c0c64414c1" },
  { id: "liveoak",     name: "Live Oak Blvd",      alias: "635c1059a967e" },
  { id: "willswood",   name: "Willswood Ln",       alias: "635c112681056" },
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

// Corridor propagation from a detection at `source` (a corridor camera).
// Mirrors src/lib/helpers.js propagate(): eastbound moves toward 0, westbound
// away from it; westbound continues through the junction onto the CN chain.
function propagate(detection, source) {
  if (!detection.train_present || !detection.direction || detection.direction === "none") return {};
  if (detection.direction === "stopped") return {};
  const speed = detection.speed_estimate_mph || DEFAULT_SPEED;
  const eastbound = detection.direction === "eastbound";
  const baseConf = detection.confidence ?? 0.8;
  const out = {};

  for (const c of CORRIDOR) {
    if (c.id === source.id) continue;
    const delta = c.dist - source.dist;
    if (delta === 0) continue;
    const distMiles = Math.abs(delta);
    const ahead = eastbound ? delta > 0 : delta < 0;
    out[c.id] = ahead
      ? {
          mode: "approaching",
          eta_mins: (60 / speed) * distMiles,
          direction: detection.direction, speed_mph: speed,
          confidence: Math.max(0, baseConf - 0.1),
          sourceId: source.id, sourceName: source.name, distMiles,
        }
      : {
          mode: "clearing",
          eta_mins: null,
          direction: detection.direction, speed_mph: speed,
          confidence: Math.max(0, baseConf - 0.2),
          sourceId: source.id, sourceName: source.name, distMiles,
        };
  }

  // Westbound trains continue through the Labarre junction onto CN McComb.
  if (!eastbound) {
    for (const c of CN_CHAIN) {
      const delta = c.dist - source.dist;
      if (delta >= 0) continue;
      const distMiles = Math.abs(delta);
      out[c.id] = {
        mode: "approaching",
        eta_mins: (60 / speed) * distMiles,
        direction: detection.direction, speed_mph: speed,
        confidence: Math.max(0, baseConf - 0.15),
        sourceId: source.id, sourceName: source.name, distMiles,
        crossedJunction: true,
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

export default async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response("No API key", { status: 500 });

  const store = getStore("rail-status");
  const now = Date.now();

  // Load history once, append all this cycle's detections, write once.
  let history = [];
  try { history = (await store.get("history", { type: "json" })) || []; } catch { /* first run */ }

  const cameras = {};      // id → detection (or offline marker)
  const corridorDetections = []; // [{source, detection}] for propagation

  // Scan ALL cameras in parallel — sequential was timing out (~15s for 9 cameras).
  // Promise.allSettled means one slow/failing camera can't break the others.
  const results = await Promise.allSettled(
    CAMERAS.map(cam => scanCamera(cam, apiKey).then(res => ({ cam, res })))
  );

  for (const r of results) {
    if (r.status === "rejected") continue;
    const { cam, res } = r.value;
    if (!res.online) {
      cameras[cam.id] = { online: false, checkedAt: now };
      continue;
    }
    const det = res.detection;
    cameras[cam.id] = { online: true, checkedAt: now, ...det };
    if (cam.corridor) {
      const src = CORRIDOR.find(c => c.id === cam.id);
      if (src) corridorDetections.push({ source: { ...src, name: cam.name }, detection: det });
    }

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

  // Merge propagation from every corridor camera that sees a train.
  // Later (higher-confidence direct source wins on conflict: keep max confidence).
  const propagated = {};
  for (const { source, detection } of corridorDetections) {
    const p = propagate(detection, source);
    for (const [id, entry] of Object.entries(p)) {
      if (!propagated[id] || (entry.confidence ?? 0) > (propagated[id].confidence ?? 0)) {
        propagated[id] = entry;
      }
    }
  }

  const metairieDetection = cameras.metairie?.online ? cameras.metairie : null;

  const status = {
    online: true,
    checkedAt: now,
    metairie: metairieDetection,   // back-compat: app reads .metairie for the hero
    cameras,                        // every camera's latest detection
    propagated,
    model: MODEL,
  };

  try { await store.setJSON("latest", status); } catch { /* blob write failed */ }
  try { await store.setJSON("history", history.slice(0, 12000)); } catch { /* blob write failed */ }

  const trainsNow = Object.values(cameras).filter(c => c.train_present).length;
  console.log(`Scan complete: ${trainsNow} camera(s) showing a train`);
  return new Response(JSON.stringify({ ok: true, trainsNow }), {
    headers: { "Content-Type": "application/json" },
  });
};

// Every 5 min, 5am–11pm Central (≈ 11:00–05:00 UTC). 9 cameras/scan.
export const config = {
  schedule: "*/5 11-23,0-5 * * *",
};
