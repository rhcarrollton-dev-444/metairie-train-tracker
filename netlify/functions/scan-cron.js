// netlify/functions/scan-cron.js
// Scheduled function — runs on a cron schedule (set in netlify.toml).
// Fetches the Metairie Rd snapshot, downscales it, sends to Claude Haiku Vision,
// propagates ETAs to camera-less crossings, and writes the result to Netlify Blobs.
// The browser app reads this via status.js for an instant answer on load.

import { getStore } from "@netlify/blobs";

const ALIAS = "62fa4c1fb9f5c"; // Metairie Rd
const MODEL = "claude-haiku-4-5-20251001";

// Corridor geometry (west of Metairie Rd camera, in miles)
const CROSSINGS = [
  { id: "labarre",   name: "Labarre Rd",   short: "Labarre",   dist: -1.05 },
  { id: "atherton",  name: "Atherton Dr",  short: "Atherton",  dist: -0.72 },
  { id: "hollywood", name: "Hollywood Dr", short: "Hollywood", dist: -0.42 },
  { id: "farnham",   name: "Farnham Pl",   short: "Farnham",   dist: -0.18 },
  { id: "metairie",  name: "Metairie Rd",  short: "Metairie Rd", dist: 0 },
];
const DEFAULT_SPEED = 15;

const VISION_PROMPT = `You are a train detection system analyzing a live railroad crossing camera image from Metairie, Louisiana (Norfolk Southern). The image may be low resolution — that is fine, you only need to determine if a train is present.

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

function propagate(detection) {
  if (!detection.train_present || !detection.direction || detection.direction === "none") return {};
  const speed = detection.speed_estimate_mph || DEFAULT_SPEED;
  const out = {};
  for (const c of CROSSINGS) {
    if (c.id === "metairie") continue;
    let eta = null;
    if (detection.direction === "westbound" && c.dist < 0) {
      eta = (60 / speed) * Math.abs(c.dist);
    } else if (detection.direction === "stopped" && Math.abs(c.dist) <= 0.5) {
      eta = 0;
    }
    if (eta !== null) {
      out[c.id] = {
        eta_mins: eta, direction: detection.direction, speed_mph: speed,
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.1),
        sourceName: "Metairie Rd", distMiles: Math.abs(c.dist),
      };
    }
  }
  return out;
}

export default async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("No ANTHROPIC_API_KEY");
    return new Response("No API key", { status: 500 });
  }

  const store = getStore("rail-status");

  try {
    // 1. Resolve snapshot URL
    const stateRes = await fetch(`https://ipcamlive.com/player/getcamerastreamstate.php?alias=${ALIAS}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.jeffparish.gov/676/Rail-Cameras" },
      signal: AbortSignal.timeout(10000),
    });
    const stateData = await stateRes.json();
    if (!stateData?.details?.address || !stateData?.details?.streamid) {
      await store.setJSON("latest", { online: false, checkedAt: Date.now(), error: "Camera offline" });
      return new Response("Camera offline", { status: 200 });
    }
    const snapshotUrl = `${stateData.details.address}streams/${stateData.details.streamid}/snapshot.jpg`;

    // 2. Fetch snapshot
    const imgRes = await fetch(snapshotUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.jeffparish.gov/676/Rail-Cameras" },
      signal: AbortSignal.timeout(12000),
    });
    if (!imgRes.ok) throw new Error(`snapshot ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.byteLength < 500) throw new Error("snapshot too small");

    // 3. Send to Claude Haiku Vision (raw image; ipcamlive snapshots are already modest size)
    const base64 = buffer.toString("base64");
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
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

    const text = aiData.content?.find(b => b.type === "text")?.text || "";
    const detection = JSON.parse(text.replace(/```json|```/g, "").trim());

    // 4. Propagate + persist
    const propagated = propagate(detection);
    const status = {
      online: true,
      checkedAt: Date.now(),
      metairie: detection,
      propagated,
      model: MODEL,
    };
    await store.setJSON("latest", status);

    // 5. Append to history (capped)
    let history = [];
    try { history = (await store.get("history", { type: "json" })) || []; } catch {}
    history.unshift({
      ts: Date.now(),
      train_present: detection.train_present,
      direction: detection.direction,
      speed_estimate_mph: detection.speed_estimate_mph,
      confidence: detection.confidence,
      crossingId: "metairie",
      crossingName: "Metairie Rd",
      notes: detection.notes,
    });
    history = history.slice(0, 1000);
    await store.setJSON("history", history);

    console.log(`Scan complete: train=${detection.train_present}`);
    return new Response(JSON.stringify({ ok: true, train: detection.train_present }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Scan failed:", err.message);
    try {
      const prev = await store.get("latest", { type: "json" }).catch(() => null);
      await store.setJSON("latest", { ...(prev || {}), lastError: err.message, lastErrorAt: Date.now() });
    } catch {}
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
};

// Cron schedule: every 5 minutes between 5am-11pm Central (11:00-05:00 UTC next day).
// Central = UTC-6 (CST) / UTC-5 (CDT). Using broad window 11-23 + 0-5 UTC to cover daytime CT.
export const config = {
  schedule: "*/5 11-23,0-5 * * *",
};
