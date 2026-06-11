/**
 * Netlify Function: snapshot-image
 * Fetches a camera snapshot JPEG and returns it as base64
 * Only proxies URLs from ipcamlive.com (security allowlist)
 */

const ALLOWED_HOSTS = ['ipcamlive.com', 'live.ipcamlive.com']

export default async (req, context) => {
  const url = new URL(req.url)
  const imageUrl = url.searchParams.get('url')

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: 'url param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Security: only allow ipcamlive domains
  let parsedUrl
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 })
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '')
  if (!ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), { status: 403 })
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

    return new Response(
      JSON.stringify({ base64: `data:${mimeType};base64,${base64}` }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/snapshot-image' }
