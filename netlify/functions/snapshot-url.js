// netlify/functions/snapshot-url.js
// Resolves a live snapshot URL from an ipcamlive camera alias.
// Called by the frontend to avoid CORS restrictions on ipcamlive.com.

export const handler = async (event) => {
  const alias = event.queryStringParameters?.alias;

  if (!alias) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing alias parameter" }),
    };
  }

  // Validate alias is alphanumeric (prevent abuse)
  if (!/^[a-f0-9]{13}$/.test(alias)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid alias format" }),
    };
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
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Invalid JSON from ipcamlive", raw: text.slice(0, 200) }),
      };
    }

    if (!data?.details?.address || !data?.details?.streamid) {
      // Camera may be offline
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          online: false,
          snapshotUrl: null,
          streamUrl: null,
          raw: data,
        }),
      };
    }

    const base = data.details.address;
    const streamId = data.details.streamid;
    const snapshotUrl = `${base}streams/${streamId}/snapshot.jpg`;
    const streamUrl = `${base}streams/${streamId}/stream.m3u8`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        online: true,
        snapshotUrl,
        streamUrl,
        alias,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
