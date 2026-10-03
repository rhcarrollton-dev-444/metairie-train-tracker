import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../data/crossings'

// Live camera viewer. Resolves the alias to a snapshot URL server-side, then
// pulls image bytes through the snapshot-image proxy (ipcamlive serves plain
// http:// which the browser would block as mixed content on our https page).
// Auto-refreshes every REFRESH_MS while mounted.
const REFRESH_MS = 15000

export default function CameraView({ alias, name, onClose }) {
  const [img, setImg] = useState(null)       // data URL
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)
  const aliveRef = useRef(true)

  const load = useCallback(async () => {
    try {
      setError(null)
      const r1 = await fetch(`${API_BASE}/snapshot-url?alias=${alias}`, { signal: AbortSignal.timeout(12000) })
      const meta = await r1.json()
      if (!meta.online || !meta.snapshotUrl) throw new Error('camera offline')
      const r2 = await fetch(`${API_BASE}/snapshot-image?url=${encodeURIComponent(meta.snapshotUrl)}&t=${Date.now()}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (!r2.ok) throw new Error(`image ${r2.status}`)
      const { base64, mediaType } = await r2.json()
      if (!aliveRef.current) return
      setImg(`data:${mediaType || 'image/jpeg'};base64,${base64}`)
      setFetchedAt(Date.now())
    } catch (err) {
      if (aliveRef.current) setError(err.message)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [alias])

  useEffect(() => {
    aliveRef.current = true
    setLoading(true)
    setImg(null)
    load()
    timerRef.current = setInterval(load, REFRESH_MS)
    return () => {
      aliveRef.current = false
      clearInterval(timerRef.current)
    }
  }, [load])

  return (
    <div
      style={{
        background: '#0d1420',
        border: '1px solid #1e2d45',
        borderRadius: 10,
        padding: 10,
        marginBottom: 12,
        animation: 'slide-in 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>
          📷 {name} — live view
        </span>
        <span style={{ fontSize: 10, color: '#475569', marginRight: 8 }}>
          {fetchedAt ? `updated ${new Date(fetchedAt).toLocaleTimeString()}` : ''}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: '#1e2d45', border: 'none', borderRadius: 6, width: 24, height: 24, color: '#94a3b8', cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>
      {img ? (
        <img
          src={img}
          alt={`${name} live camera`}
          style={{ width: '100%', borderRadius: 8, display: 'block' }}
        />
      ) : (
        <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 12, color: error ? '#fca5a5' : '#475569' }}>
          {loading ? 'Loading camera…' : error ? `⚠ ${error}` : 'No image'}
        </div>
      )}
      <div style={{ fontSize: 9, color: '#283548', marginTop: 6 }}>
        Refreshes every {REFRESH_MS / 1000}s · Jefferson Parish rail camera
      </div>
    </div>
  )
}
