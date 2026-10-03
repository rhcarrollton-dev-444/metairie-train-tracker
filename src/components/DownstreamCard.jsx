import Dot from './Dot'
import { statusBadge } from '../lib/helpers'

// Card for a non-camera corridor crossing showing its propagated ETA/clearing (`jp`).
export default function DownstreamCard({ crossing, prop, isSelected, onClick }) {
  const badge = statusBadge(crossing, {}, prop ? { [crossing.id]: prop } : {})
  const idle = !prop
  return (
    <div
      onClick={onClick}
      style={{
        background: idle ? '#0b111c' : badge.bg,
        border: `1px solid ${isSelected ? badge.color : idle ? '#161f30' : badge.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot color={idle ? '#2d3a4f' : badge.color} pulse={!idle && badge.urgent} size={10} />
        <span style={{ flex: 1, fontSize: 14, color: idle ? '#cbd5e1' : '#f1f5f9', fontWeight: 700 }}>
          {crossing.short}
          {prop?.mode === 'approaching' && <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 400 }}> · train approaching</span>}
          {prop?.mode === 'clearing' && <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 400 }}> · train passing through</span>}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: idle ? '#475569' : badge.color }}>{idle ? 'Clear' : badge.label}</span>
      </div>
    </div>
  )
}