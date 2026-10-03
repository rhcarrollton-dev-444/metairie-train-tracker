import { useState } from 'react'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'
import FeaturedCard from './FeaturedCard'
import DownstreamCard from './DownstreamCard'
import DetailPanel from './DetailPanel'
import WatchCameras from './WatchCameras'
import ManualScanPanel from './ManualScanPanel'

// Corridor tab (`kp`): featured camera crossing, selected detail panel,
// downstream crossings, watch cameras, manual scan controls.
export default function CorridorView({
  detections,
  propagated,
  analyzing,
  isPolling,
  intervalSecs,
  errors,
  selected,
  setSelected,
  onScan,
  onTogglePolling,
  onSetInterval,
  onReport,
  alerts,
  setAlerts,
  serverStatus,
}) {
  const [showManual, setShowManual] = useState(false)
  const cameraCrossings = CORRIDOR.filter((c) => c.hasCamera)
  const downstreamCrossings = [...CORRIDOR].filter((c) => !c.hasCamera).reverse() // west -> from metairie outward
  
  // CN crossings west of the junction that get propagated predictions
  const cnCrossings = DOWNSTREAM.filter((c) => c.corridor === 'cn')

  const anyApproaching = downstreamCrossings.some((c) => propagated[c.id]?.mode === 'approaching')
  const anyClearing = downstreamCrossings.some((c) => propagated[c.id]?.mode === 'clearing')
  const caption = anyApproaching
    ? 'train approaching'
    : anyClearing
    ? 'train passing through'
    : 'predicted from camera'
  
  const anyCnPropagated = cnCrossings.some((c) => propagated[c.id])

  return (
    <div style={{ padding: 14 }}>
      {cameraCrossings.map((c) => (
        <FeaturedCard
          key={c.id}
          crossing={c}
          detection={detections[c.id]}
          prop={propagated[c.id]}
          isSelected={selected?.id === c.id}
          onClick={() => setSelected(selected?.id === c.id ? null : c)}
          onReport={() => onReport(c)}
        />
      ))}

      {selected && (
        <DetailPanel
          crossing={selected}
          detection={detections[selected.id]}
          prop={propagated[selected.id]}
          onClose={() => setSelected(null)}
          onReport={onReport}
          alerts={alerts}
          setAlerts={setAlerts}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#475569', letterSpacing: 0.6 }}>DOWNSTREAM CROSSINGS</span>
        <div style={{ flex: 1, height: 1, background: '#1a2435' }} />
        <span style={{ fontSize: 10, color: '#334155' }}>{caption}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {downstreamCrossings.map((c) => (
          <DownstreamCard
            key={c.id}
            crossing={c}
            prop={propagated[c.id]}
            isSelected={selected?.id === c.id}
            onClick={() => setSelected(selected?.id === c.id ? null : c)}
          />
        ))}
      </div>

      {anyCnPropagated && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#475569', letterSpacing: 0.6 }}>WESTERN CHAIN (CN)</span>
            <div style={{ flex: 1, height: 1, background: '#1a2435' }} />
            <span style={{ fontSize: 10, color: '#334155' }}>via Labarre junction</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {cnCrossings.map((c) => (
              <DownstreamCard
                key={c.id}
                crossing={c}
                prop={propagated[c.id]}
                isSelected={selected?.id === c.id}
                onClick={() => setSelected(selected?.id === c.id ? null : c)}
              />
            ))}
          </div>
        </>
      )}

      <WatchCameras serverStatus={serverStatus} propagated={propagated} />

      <button
        onClick={() => setShowManual((s) => !s)}
        style={{
          marginTop: 16,
          width: '100%',
          background: 'none',
          border: '1px solid #1a2435',
          color: '#475569',
          borderRadius: 8,
          padding: 8,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {showManual ? 'Hide manual scan' : 'Manual scan & settings'}
      </button>

      {showManual && (
        <div style={{ marginTop: 10 }}>
          <ManualScanPanel
            analyzing={analyzing}
            isPolling={isPolling}
            intervalSecs={intervalSecs}
            onScan={onScan}
            onTogglePolling={onTogglePolling}
            onSetInterval={onSetInterval}
          />
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ background: '#2d0a0a', border: '1px solid #ef444433', borderRadius: 8, marginTop: 10, padding: '10px 12px' }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: '#fca5a5' }}>
              ⚠ {e}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}