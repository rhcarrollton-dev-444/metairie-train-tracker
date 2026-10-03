import { confidenceBadge } from '../lib/helpers'

// Small label/value stat tile used inside the detail panel (`Re`).
export default function StatTile({ label, value, color, large }) {
  return (
    <div style={{ background: '#0a1018', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: '#475569', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: large ? 18 : 14, fontWeight: 800, color: color || '#e2e8f0' }}>{value}</div>
    </div>
  )
}

export function ConfidenceTile({ confidence }) {
  const c = confidenceBadge(confidence)
  return (
    <StatTile
      label="Confidence"
      value={confidence != null ? `${Math.round(confidence * 100)}%` : '—'}
      color={c.color}
    />
  )
}