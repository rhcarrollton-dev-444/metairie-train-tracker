const TABS = [
  { id: 'corridor', label: '🗺 Corridor' },
  { id: 'heatmap', label: '🔥 Heatmap' },
  { id: 'log', label: '📋 Log' },
  { id: 'about', label: 'ℹ About' },
]

export default function Tabs({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #1e2d45', background: '#0a0e16' }}>
      {TABS.map((t) => {
        const active = tab === t.id
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '10px 2px',
              fontSize: 10,
              fontWeight: 700,
              color: active ? '#60a5fa' : '#475569',
              background: 'none',
              border: 'none',
              borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}