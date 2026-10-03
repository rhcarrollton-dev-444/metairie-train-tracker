import { DOWNSTREAM } from '../data/crossings'

// "WATCH CAMERAS" panel — shows downstream camera status from server polling (`Cp`).
// These are scanned server-side; the app itself only scans the metairie camera.
// CN crossings with propagated predictions are shown in the dedicated CN section above.
export default function WatchCameras({ serverStatus, propagated }) {
  const cameras = serverStatus?.cameras || {}
  
  // Filter to show only cameras without propagated predictions or on separate corridors
  const visibleCrossings = DOWNSTREAM.filter((c) => {
    if (c.corridor === 'cn' && propagated?.[c.id]) return false // shown in CN section
    return true
  })
  
  const hasData = visibleCrossings.some((c) => cameras[c.id])
  const trainCount = visibleCrossings.filter((c) => cameras[c.id]?.train_present).length

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#475569', letterSpacing: 0.6 }}>WATCH CAMERAS</span>
        <div style={{ flex: 1, height: 1, background: '#1a2435' }} />
        <span style={{ fontSize: 10, color: '#334155' }}>
          {trainCount > 0 ? `${trainCount} showing a train` : 'data collection'}
        </span>
      </div>
      {hasData ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
          {visibleCrossings.map((c) => {
            const cam = cameras[c.id]
            const offline = !cam || cam.online === false
            const train = cam?.train_present
            return (
              <div
                key={c.id}
                style={{
                  background: train ? '#1a0d0d' : '#0b111c',
                  border: `1px solid ${train ? '#ef444455' : '#161f30'}`,
                  borderRadius: 10,
                  padding: '9px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: offline ? '#2d3a4f' : train ? '#ef4444' : '#22c55e',
                      boxShadow: `0 0 6px ${offline ? '#2d3a4f' : train ? '#ef4444' : '#22c55e'}`,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, flex: 1 }}>{c.short}</span>
                </div>
                <div style={{ fontSize: 10, color: '#3a4a63', marginTop: 2 }}>{c.area}</div>
                <div style={{ fontSize: 10, color: offline ? '#475569' : train ? '#ef4444' : '#22c55e' }}>
                  {offline ? '—' : train ? 'TRAIN' : 'Clear'}
                </div>
                {train && cam.notes && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#94a3b8',
                      fontStyle: 'italic',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cam.notes}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#334155' }}>
          Waiting for the server to report camera data… (these come from the corridor status
          poll, not your local scans.)
        </div>
      )}
      <div style={{ fontSize: 9, color: '#283548', marginTop: 8 }}>
        These cameras are scanned to learn which ones correlate with the Old Metairie corridor. Once the
        data shows the pattern, unrelated cameras can be dropped.
      </div>
    </div>
  )
}