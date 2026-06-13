// netlify/functions/send-alert.js
// Sends email alerts when a train is detected or cleared.
// Uses Resend (resend.com) — free tier is 3,000 emails/month.
// Requires RESEND_API_KEY and ALERT_FROM_EMAIL env vars in Netlify.
// Rate-limited: one alert per crossing per 30 minutes (tracked via in-memory map,
// resets on function cold start — good enough for serverless).

const cooldowns = new Map(); // crossingId → last alert timestamp
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL || "alerts@metairierailtracker.com";

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "RESEND_API_KEY not configured" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { email, crossingId, crossingName, eventType, direction, speed, eta, notes } = body;

  if (!email || !crossingId || !eventType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid email address" }) };
  }

  // Cooldown check
  const cooldownKey = `${email}:${crossingId}`;
  const lastAlert = cooldowns.get(cooldownKey) || 0;
  if (Date.now() - lastAlert < COOLDOWN_MS) {
    const minsRemaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastAlert)) / 60000);
    return {
      statusCode: 429,
      body: JSON.stringify({ error: `Cooldown active — ${minsRemaining} min remaining` }),
    };
  }

  const isTrainEvent = eventType === "train_detected";
  const subject = isTrainEvent
    ? `🚂 Train at ${crossingName} — Metairie Rail Tracker`
    : `✓ ${crossingName} Cleared — Metairie Rail Tracker`;

  const directionLine = direction && direction !== "none"
    ? `<p><strong>Direction:</strong> ${direction}</p>` : "";
  const speedLine = speed
    ? `<p><strong>Estimated Speed:</strong> ${speed} mph</p>` : "";
  const etaLine = eta
    ? `<p><strong>ETA at your crossing:</strong> ${eta}</p>` : "";
  const notesLine = notes
    ? `<p><strong>AI Observation:</strong> <em>${notes}</em></p>` : "";

  const html = isTrainEvent ? `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px;">
      <div style="font-size:28px;margin-bottom:8px;">🚂</div>
      <h2 style="color:#fca5a5;margin:0 0 16px;">Train Detected at ${crossingName}</h2>
      <p style="color:#94a3b8;margin:0 0 16px;">Norfolk Southern · Old Metairie Corridor</p>
      ${directionLine}
      ${speedLine}
      ${etaLine}
      ${notesLine}
      <p style="color:#64748b;font-size:12px;margin-top:24px;">
        Detected by Claude Vision AI · ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT<br/>
        <a href="https://fascinating-platypus-46f604.netlify.app" style="color:#60a5fa;">View live tracker</a>
      </p>
      <p style="color:#374151;font-size:11px;margin-top:8px;">
        You're receiving this because you subscribed to alerts for ${crossingName}.
      </p>
    </div>
  ` : `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px;">
      <div style="font-size:28px;margin-bottom:8px;">✅</div>
      <h2 style="color:#86efac;margin:0 0 16px;">${crossingName} is Clear</h2>
      <p style="color:#94a3b8;margin:0 0 16px;">Norfolk Southern · Old Metairie Corridor</p>
      <p>The crossing has been confirmed clear by Claude Vision AI.</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px;">
        Cleared at ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT<br/>
        <a href="https://fascinating-platypus-46f604.netlify.app" style="color:#60a5fa;">View live tracker</a>
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: err.message || "Resend API error" }),
      };
    }

    cooldowns.set(cooldownKey, Date.now());

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent: true, subject }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
