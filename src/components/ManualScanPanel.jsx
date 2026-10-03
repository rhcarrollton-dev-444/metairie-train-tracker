const INTERVALS = [10, 15, 30, 60]

// Manual scan + auto-scan interval controls (`zp`).
export default function ManualScanPanel({ analyzing, isPolling, intervalSecs, onScan, onTogglePolling, onSetInterval }) {
  return (
    <div style={{ background: '#0d1420', border: '1px solid #1e2d45', borderRadius: 10, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <button
        onClick={onScan}
        disabled={analyzing}
        style={{
          background: analyzing ? '#1a2535' : '#1d4ed8',
          color: analyzing ? '#475569' : '#fff',
          border: 'none',
          borderRadius: 7,
          padding: '8px 14px',
          fontWeight: 700,
          fontSize: 13,
          cursor: analyzing ? 'not-allowed' : 'pointer',
        }}
      >
        {analyzing ? '⏳ Scanning…' : '🔍 Scan Now'}
      </button>
      <button
        onClick={onTogglePolling}
        style={{
          background: isPolling ? '#450a0a' : '#052e16',
          border: `1px solid ${isPolling ? '#ef444466' : '#16a34a66'}`,
          color: isPolling ? '#fca5a5' : '#86efac',
          borderRadius: 7,
          padding: '8px 14px',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {isPolling ? '⏹ Stop' : '▶ Auto-Scan'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: '#475569' }}>every</span>
        {INTERVALS.map((s) => {
          const active = intervalSecs === s
          return (
            <button
              key={s}
              onClick={() => onSetInterval(s)}
              style={{
                background: active ? '#1e3a5f' : 'none',
                border: `1px solid ${active ? '#3b82f6' : '#1e2d45'}`,
                color: active ? '#60a5fa' : '#475569',
                fontWeight: active ? 700 : 400,
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {s}s
            </button>
          )
        })}
      </div>
    </div>
  )
}