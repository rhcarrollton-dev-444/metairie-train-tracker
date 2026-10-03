import { useState } from 'react'

// Log tab (`Tp`): merged scan + community report entries, filterable.
export default function Log({ scanLog, reports }) {
  const [filter, setFilter] = useState('all')

  const merged = [
    ...scanLog.map((x) => ({ ...x, _type: 'scan' })),
    ...reports.map((x) => ({ ...x, _type: 'report' })),
  ].sort((a, b) => b.ts - a.ts)

  const shown =
    filter === 'scans' ? merged.filter((x) => x._type === 'scan') : filter === 'reports' ? merged.filter((x) => x._type === 'report') : merged

  const filters = [
    { id: 'all', label: 'All', count: merged.length },
    { id: 'scans', label: 'Scans', count: scanLog.length },
    { id: 'reports', label: 'Reports', count: reports.length },
  ]

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {filters.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                background: active ? '#1e3a5f' : '#0a1018',
                border: `1px solid ${active ? '#3b82f6' : '#1e2d45'}`,
                color: active ? '#60a5fa' : '#475569',
                borderRadius: 7,
                padding: '6px 10px',
                fontSize: 11,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
            >
              {f.label} ({f.count})
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#334155', fontSize: 13 }}>No entries yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
          {shown.slice(0, 100).map((x, i) => (
            <div
              key={i}
              style={{
                background: '#0d1420',
                border: `1px solid ${x.train_present ? '#ef444433' : '#1e2d45'}`,
                borderRadius: 8,
                padding: '9px 12px',
                animation: 'slide-in 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: x.train_present ? '#ef4444' : '#22c55e',
                    boxShadow: x.train_present ? '0 0 6px #ef4444' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 8, color: '#334155' }}>{x._type === 'report' ? '👤' : '🤖'}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>{x.crossingName}</span>
                <span style={{ fontSize: 9, color: '#334155', fontFamily: 'JetBrains Mono, monospace' }}>
                  {new Date(x.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 11, color: x.train_present ? '#fca5a5' : '#86efac', marginTop: 3 }}>
                {x.train_present ? '🚂 TRAIN' : '✓ Clear'}
                {x.direction && x.direction !== 'none' && ` · ${x.direction}`}
                {x.speed_estimate_mph != null && ` · ${x.speed_estimate_mph} mph`}
                {x.speed_mph != null && ` · ${x.speed_mph} mph`}
                {x.confidence != null && ` · ${Math.round(x.confidence * 100)}% conf`}
                {x.length && ` · ${x.length}`}
              </div>
              {(x.notes || x.note) && (
                <div style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic', marginTop: 2 }}>{x.notes || x.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}