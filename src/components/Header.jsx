import { relativeTime } from '../lib/helpers'

// App header: title, scan indicator, and corridor status bar (`Sp`).
export default function Header({ anyUrgent, analyzing, lastScan, isPolling, intervalSecs, serverStatus }) {
  const checked = serverStatus?.checkedAt ? relativeTime(serverStatus.checkedAt) : null
  return (
    <div
      style={{
        background: 'linear-gradient(180deg,#0f172a 0%,#080b10 100%)',
        borderBottom: '1px solid #1e2d45',
        padding: '14px 16px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: anyUrgent ? '#ef4444' : '#1e3a5f',
            boxShadow: anyUrgent ? '0 0 18px #ef444480' : 'none',
            animation: anyUrgent ? 'glow-red 2s infinite' : 'none',
            fontSize: 18,
          }}
        >
          🚂
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9' }}>Metairie Rail Tracker</div>
          <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.6 }}>
            OLD METAIRIE CORRIDOR · NORFOLK SOUTHERN
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {analyzing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  animation: 'pulse-dot 1s infinite',
                }}
              />
              <span style={{ fontSize: 10, color: '#60a5fa' }}>SCANNING</span>
            </div>
          ) : isPolling ? (
            <span style={{ fontSize: 10, color: '#22c55e' }}>▶ AUTO {intervalSecs}s</span>
          ) : lastScan ? (
            <span style={{ fontSize: 10, color: '#334155' }}>{relativeTime(lastScan)}</span>
          ) : null}
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: anyUrgent ? '#450a0a' : '#052e16',
          border: `1px solid ${anyUrgent ? '#ef444455' : '#16a34a44'}`,
          color: anyUrgent ? '#fca5a5' : '#86efac',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 8,
          padding: '7px 12px',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: anyUrgent ? '#ef4444' : '#22c55e',
            boxShadow: `0 0 8px ${anyUrgent ? '#ef4444' : '#22c55e'}`,
            animation: anyUrgent ? 'pulse-dot 1s infinite' : 'none',
          }}
        />
        <span style={{ flex: 1 }}>{anyUrgent ? '⚠  TRAIN ACTIVITY ON CORRIDOR' : '✓  ALL CROSSINGS CLEAR'}</span>
        {checked && (
          <span style={{ fontSize: 10, color: anyUrgent ? '#fca5a588' : '#86efac88' }}>auto-checked {checked}</span>
        )}
      </div>
    </div>
  )
}