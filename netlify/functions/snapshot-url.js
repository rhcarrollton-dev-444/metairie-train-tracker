/**
 * Netlify Function: snapshot-url
 * Resolves an ipcamlive camera alias to a live snapshot URL
 * No API key needed — uses the undocumented player endpoint
 */

export default async (req, context) => {
  const url = new URL(req.url)
  const alias = url.searchParams.get('alias')

  if (!alias) {
    return new Response(JSON.stringify({ error: 'alias param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const apiUrl = `https://ipcamlive.com/player/getcamerastreamstate.php?alias=${encodeURIComponent(alias)}`
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetairieRailTracker/1.0)' },
    })

    if (!res.ok) throw new Error(`ipcamlive returned ${res.status}`)

    const data = await res.json()

    // ipcamlive returns { address, snapshotaddress, ... }
    const snapshotUrl = data.snapshotaddress || data.address?.replace('/stream', '/snapshot.jpg')
    if (!snapshotUrl) throw new Error('No snapshot URL in ipcamlive response')

    return new Response(JSON.stringify({ snapshotUrl }), {
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

export const config = { path: '/api/snapshot-url' }
