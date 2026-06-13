// netlify/functions/analyze-vision.js
// Proxies vision analysis requests to Anthropic API.
// The API key is stored as a Netlify environment variable (ANTHROPIC_API_KEY),
// so it never needs to be exposed in the browser.
// Accepts POST with { base64, mediaType, crossingId, crossingName }
// Returns the structured train detection JSON.

const VISION_PROMPT = `You are a train detection system analyzing a live railroad crossing camera image from Metairie, Louisiana (Norfolk Southern Old Metairie corridor).

Analyze this image and respond ONLY with a valid JSON object — no markdown, no code fences, no extra text whatsoever.

{
  "train_present": boolean,
  "confidence": number (0.0–1.0),
  "crossing_blocked": boolean,
  "direction": "eastbound" | "westbound" | "stopped" | "none",
  "speed_estimate_mph": number | null,
  "train_visible": boolean,
  "gates_down": boolean | null,
  "notes": string (max 80 chars, plain text only)
}

Detection rules:
- train_present: true if ANY railcar, locomotive, or part of a train is visible, OR if crossing gates are visibly lowered
- crossing_blocked: true only if the crossing road itself is physically blocked by train cars
- direction: estimate from motion blur, car numbering direction, or any visible motion cues; "none" if no train
- speed_estimate_mph: integer estimate based on motion blur; null if stopped, unknown, or no train
- gates_down: true/false if crossing gate arms are visible; null if gates are not visible in frame
- notes: brief plain English description of what you actually see in the image (tracks, cars, vehicles waiting, weather, etc.)
- If image is dark, blurry, or otherwise unclear: set train_present false, confidence 0.25, direction "none", all others null
- Confidence should reflect how clearly you can see the scene, not just whether a train is present`;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable not set" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { base64, mediaType = "image/jpeg", crossingId, crossingName } = body;

  if (!base64) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing base64 field" }) };
  }

  // Basic size check — reject if suspiciously large (>4MB base64 ≈ 3MB image)
  if (base64.length > 5_500_000) {
    return { statusCode: 400, body: JSON.stringify({ error: "Image too large" }) };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: VISION_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: `Analyze this live camera image from the ${crossingName || crossingId || "railroad"} crossing.`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data?.error?.message || "Anthropic API error", detail: data }),
      };
    }

    const text = data.content?.find((b) => b.type === "text")?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let detection;
    try {
      detection = JSON.parse(clean);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Could not parse model response as JSON", raw: clean }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...detection,
        crossingId,
        analyzedAt: new Date().toISOString(),
        model: "claude-sonnet-4-20250514",
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
