// netlify/functions/status.js
// Returns the latest train status written by scan-cron.js.
// The browser app calls this on load for an instant answer.

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("rail-status");
  const url = new URL(req.url);
  const wantHistory = url.searchParams.get("history") === "1";

  try {
    const latest = await store.get("latest", { type: "json" }).catch(() => null);

    let history = null;
    if (wantHistory) {
      history = await store.get("history", { type: "json" }).catch(() => null);
    }

    return new Response(JSON.stringify({
      latest: latest || null,
      history: history || undefined,
      serverTime: Date.now(),
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
