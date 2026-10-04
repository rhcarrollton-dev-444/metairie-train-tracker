// netlify/functions/snapshot-url.js
// Resolves a live snapshot URL from an ipcamlive camera alias.
// Called by the frontend to avoid CORS restrictions on ipcamlive.com.

import { jsonResponse, preflight } from "./_cors.js";

export const handler = async (event) => {
  const pf = preflight(event);
  if (pf) return pf;

  const alias = event.queryStringParameters?.alias;

  if (!alias) {
    return jsonResponse({ error: "Missing alias parameter" }, { status: 400 });
  }

  // Validate alias is alphanumeric (prevent abuse)
  if (!/^[a-f0-9]{13}$/.test(alias)) {
    return jsonResponse({ error: "Invalid alias format" }, { status: 400 });
  }

  const url = `https://ipcamlive.com/player/getcamerastreamstate.php?alias=${alias}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MetairieTrainTracker/1.0)",
        "Referer": "https://www.jeffparish.gov/676/Rail-Cameras",
        "Accept": "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();

    // ipcamlive returns JSON with stream details
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "Invalid JSON from ipcamlive", raw: text.slice(0, 200) }, { status: 502 });
    }

    if (!data?.details?.address || !data?.details?.streamid) {
      // Camera may be offline
      return jsonResponse({
        online: false,
        snapshotUrl: null,
        streamUrl: null,
        raw: data,
      });
    }

    const base = data.details.address;
    const streamId = data.details.streamid;
    const snapshotUrl = `${base}streams/${streamId}/snapshot.jpg`;
    const streamUrl = `${base}streams/${streamId}/stream.m3u8`;

    return jsonResponse(
      {
        online: true,
        snapshotUrl,
        streamUrl,
        alias,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, { status: 502 });
  }
};
