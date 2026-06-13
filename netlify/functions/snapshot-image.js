// netlify/functions/snapshot-image.js
// Fetches a snapshot image from ipcamlive CDN and returns it as base64.
// This runs server-side so there are no CORS issues fetching from ipcamlive servers.

const ALLOWED_HOSTS = [
  "ipcamlive.com",
  ".ipcamlive.com",
];

function isAllowedUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ALLOWED_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(h)
    );
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  const imageUrl = event.queryStringParameters?.url;

  if (!imageUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing url parameter" }) };
  }

  if (!isAllowedUrl(imageUrl)) {
    return { statusCode: 403, body: JSON.stringify({ error: "URL not in allowlist" }) };
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MetairieTrainTracker/1.0)",
        "Referer": "https://www.jeffparish.gov/676/Rail-Cameras",
        "Accept": "image/jpeg,image/*,*/*",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `Upstream returned ${res.status}` }),
      };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    if (buffer.byteLength < 500) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Image too small — camera may be offline" }),
      };
    }

    // Convert to base64
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        base64,
        mediaType: contentType.split(";")[0].trim(),
        sizeBytes: buffer.byteLength,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
