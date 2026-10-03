// Centered stat tile used in the heatmap header (`So`).
export default function HeatmapStat({ label, value, color }) {
  return (
    <div
      style={{
        background: '#0d1420',
        border: '1px solid #1e2d45',
        borderRadius: 8,
        padding: '10px 12px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#e2e8f0' }}>{value}</div>
    </div>
  )
}