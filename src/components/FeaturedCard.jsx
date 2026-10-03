import Dot from './Dot'
import { statusBadge } from '../lib/helpers'

// Featured card for a camera crossing (`_p`). Only metairie in practice.
export default function FeaturedCard({ crossing, detection, prop, isSelected, onClick, onReport }) {
  const badge = statusBadge(crossing, detection ? { [crossing.id]: detection } : {}, prop ? { [crossing.id]: prop } : {})
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: badge.bg,
        border: `1px solid ${isSelected ? badge.color : badge.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        cursor: 'pointer',
        boxShadow: badge.urgent ? `0 0 16px ${badge.border}44` : 'none',
        marginBottom: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Dot color={badge.color} pulse={badge.urgent} size={14} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{crossing.name}</span>
          <span style={{ fontSize: 9, color: '#3a4a63', letterSpacing: 0.3 }}>LIVE CAMERA</span>
        </div>
        {detection?.notes ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detection.notes}
          </div>
        ) : !detection ? (
          <div style={{ fontSize: 12, color: '#475569' }}>Waiting for first scan…</div>
        ) : null}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: badge.color }}>{badge.label}</div>
        {detection?.confidence != null && (
          <div style={{ fontSize: 9, color: '#3a4a63' }}>{Math.round(detection.confidence * 100)}% confident</div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onReport()
        }}
        title="Report"
        style={{
          background: '#0a1018',
          border: '1px solid #1e2d45',
          borderRadius: 7,
          color: '#475569',
          fontSize: 13,
          padding: '4px 8px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        📝
      </button>
    </div>
  )
}