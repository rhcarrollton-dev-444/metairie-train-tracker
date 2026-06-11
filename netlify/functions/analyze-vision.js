/**
 * Netlify Function: analyze-vision
 * Proxies a base64 image to Claude Vision for train detection
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `You are a train detection AI analyzing live camera footage of a railroad crossing in Metairie, Louisiana.

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
- train_present: true if any part of a train is visible or gates are clearly down with a train visible
- confidence: your certainty (0.9+ = very sure, 0.5-0.8 = probably, below 0.5 = uncertain)
- direction: which way the train is moving; "none" if no train
- speed_estimate_mph: estimate from motion blur; null if stationary or no train
- gates_down: true if crossing arms are lowered; null if not visible
- notes: brief description of what you see`

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST required' }) }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' })
    }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { image } = body
  if (!image || !image.startsWith('data:image/')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'image field required (data URI)' }) }
  }

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
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: 'Analyze this railroad crossing image and return the JSON detection result.' }
          ]
        }]
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Anthropic API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const content = data.content?.[0]?.text || '{}'

    let detection
    try {
      detection = JSON.parse(content)
    } catch {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      detection = match ? JSON.parse(match[1]) : { error: 'Could not parse response', raw: content }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(detection)
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
