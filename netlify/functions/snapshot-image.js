/**
 * Netlify Function: snapshot-image
 * Fetches a camera snapshot JPEG and returns it as base64
 */

const ALLOWED_HOSTS = ['ipcamlive.com']  // matches ipcamlive.com and all subdomains like s92.ipcamlive.com

exports.handler = async function(event, context) {
  const imageUrl = event.queryStringParameters?.url

  if (!imageUrl) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'url param required' })
    }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid URL' }) }
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '')
  if (!ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Domain not allowed' }) }
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MetairieRailTracker/1.0)',
        'Accept': 'image/jpeg,image/*',
      },
    })

    if (!res.ok) throw new Error(`Image fetch returned ${res.status}`)

    const arrayBuffer = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mimeType = res.headers.get('content-type') || 'image/jpeg'

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ base64: `data:${mimeType};base64,${base64}` })
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
