/**
 * Netlify Function: snapshot-url
 * Resolves an ipcamlive camera alias to a live snapshot URL
 */

exports.handler = async function(event, context) {
  const alias = event.queryStringParameters?.alias

  if (!alias) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'alias param required' })
    }
  }

  try {
    const apiUrl = `https://ipcamlive.com/player/getcamerastreamstate.php?alias=${encodeURIComponent(alias)}`
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetairieRailTracker/1.0)' },
    })

    if (!res.ok) throw new Error(`ipcamlive returned ${res.status}`)

    const data = await res.json()
    const details = data.details || data

    // Build snapshot URL from stream address + streamid
    // Format: http://s92.ipcamlive.com/streams/{streamid}/snapshot.jpg
    let snapshotUrl = data.snapshotaddress || null
    if (!snapshotUrl && details.address && details.streamid) {
      const base = details.address.endsWith('/') ? details.address : details.address + '/'
      snapshotUrl = `${base}streams/${details.streamid}/snapshot.jpg`
    }
    if (!snapshotUrl) throw new Error('No snapshot URL in ipcamlive response')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ snapshotUrl })
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
