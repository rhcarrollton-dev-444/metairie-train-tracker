/**
 * Netlify Function: analyze-vision
 * Proxies a base64 image to Claude Vision for train detection
 * API key lives server-side in Netlify env — never exposed to browser
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `You are a train detection AI analyzing live camera footage of a railroad crossing in Metairie, Louisiana.

Your job is to determine whether a train is present at or approaching this crossing.

Respond with ONLY valid JSON in this exact format:
{
  "train_present": true or false,
  "confidence": 0.0-1.0,
  "direction": "westbound" | "eastbound" | "stationary" | "none",
  "speed_estimate_mph": number or null,
  "gates_down": true or false or null,
  "notes": "brief description of what you see"
}

Guidelines:
- train_present: true if any part of a train is visible or the gates are clearly down with a train visible
- confidence: your certainty level (0.9+ = very sure, 0.5-0.8 = probably, below 0.5 = uncertain)
- direction: which way the train is moving based on motion blur or visible front/back; "none" if no train
- speed_estimate_mph: estimate from motion blur or crossing duration; null if stationary or no train
- gates_down: true if crossing arms are lowered; null if not visible
- notes: what you actually see in the image (train cars, clear tracks, gates, etc.)`

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { image } = body
  if (!image || !image.startsWith('data:image/')) {
    return new Response(JSON.stringify({ error: 'image field required (data URI)' }), { status: 400 })
  }

  // Strip the data URI prefix to get raw base64
  const base64Data = image.split(',')[1]
  const mediaType = image.split(';')[0].replace('data:', '') || 'image/jpeg'

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: 'Analyze this railroad crossing image and return the JSON detection result.',
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Anthropic API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const content = data.content?.[0]?.text || '{}'

    // Parse the JSON from Claude's response
    let detection
    try {
      detection = JSON.parse(content)
    } catch {
      // Try to extract JSON from markdown code block
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      detection = match ? JSON.parse(match[1]) : { error: 'Could not parse response', raw: content }
    }

    return new Response(JSON.stringify(detection), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/analyze-vision' }
