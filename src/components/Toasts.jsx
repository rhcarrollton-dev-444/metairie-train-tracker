// Bottom-center toast stack.
export default function Toasts({ toasts }) {
  if (!toasts.length) return null
  const styleFor = (type) => {
    if (type === 'success') return { background: '#052e16', border: '1px solid #16a34a', color: '#86efac' }
    if (type === 'error') return { background: '#450a0a', border: '1px solid #ef4444', color: '#fca5a5' }
    return { background: '#0c1a2e', border: '1px solid #3b82f6', color: '#93c5fd' }
  }
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 999,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            ...styleFor(t.type),
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            animation: 'slide-in 0.2s ease',
            boxShadow: '0 4px 20px #00000080',
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}