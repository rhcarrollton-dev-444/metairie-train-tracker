import { useState } from 'react'

const DIRECTIONS = [
  { id: 'westbound', label: '← West' },
  { id: 'eastbound', label: 'East →' },
  { id: 'stopped', label: '⏹ Stopped' },
]
const LENGTHS = ['short', 'medium', 'long']

// Bottom-sheet modal for submitting a community train report (`Np`).
export default function ReportModal({ crossing, onSubmit, onClose }) {
  const [trainPresent, setTrainPresent] = useState(true)
  const [direction, setDirection] = useState('westbound')
  const [speed, setSpeed] = useState('')
  const [length, setLength] = useState('medium')
  const [note, setNote] = useState('')

  const submit = () =>
    onSubmit({
      crossingId: crossing.id,
      crossingName: crossing.name,
      train_present: trainPresent,
      direction: trainPresent ? direction : 'none',
      speed_mph: speed ? parseInt(speed, 10) : null,
      length,
      note: note.trim(),
    })

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d1420',
          border: '1px solid #1e2d45',
          borderRadius: '12px 12px 0 0',
          padding: 20,
          maxWidth: 480,
          width: '100%',
          animation: 'slide-in 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>Report Train</div>
            <div style={{ fontSize: 11, color: '#475569' }}>{crossing.name}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: '#1e2d45', border: 'none', borderRadius: 6, width: 28, height: 28, color: '#94a3b8', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setTrainPresent(true)}
            style={{
              flex: 1,
              background: trainPresent ? '#450a0a' : '#0a1018',
              border: `1px solid ${trainPresent ? '#ef4444' : '#1e2d45'}`,
              color: trainPresent ? '#fca5a5' : '#475569',
              borderRadius: 8,
              padding: '10px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🚂 Train Here
          </button>
          <button
            onClick={() => setTrainPresent(false)}
            style={{
              flex: 1,
              background: !trainPresent ? '#052e16' : '#0a1018',
              border: `1px solid ${!trainPresent ? '#22c55e' : '#1e2d45'}`,
              color: !trainPresent ? '#86efac' : '#475569',
              borderRadius: 8,
              padding: '10px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✓ All Clear
          </button>
        </div>

        {trainPresent && (
          <>
            <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.5, marginBottom: 6 }}>DIRECTION</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {DIRECTIONS.map((d) => {
                const active = direction === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => setDirection(d.id)}
                    style={{
                      flex: 1,
                      background: active ? '#1e3a5f' : '#0a1018',
                      border: `1px solid ${active ? '#3b82f6' : '#1e2d45'}`,
                      color: active ? '#60a5fa' : '#475569',
                      borderRadius: 7,
                      padding: '8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>

            <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.5, marginBottom: 6 }}>ESTIMATED SPEED (MPH, optional)</div>
            <input
              type="number"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="e.g. 10"
              style={{
                width: '100%',
                background: '#0d1420',
                border: '1px solid #1e2d45',
                color: '#e2e8f0',
                borderRadius: 7,
                padding: '9px 10px',
                fontSize: 13,
                marginBottom: 14,
              }}
            />

            <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.5, marginBottom: 6 }}>TRAIN LENGTH</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {LENGTHS.map((l) => {
                const active = length === l
                return (
                  <button
                    key={l}
                    onClick={() => setLength(l)}
                    style={{
                      flex: 1,
                      background: active ? '#1e2d45' : '#0a1018',
                      border: `1px solid ${active ? '#475569' : '#1e2d45'}`,
                      color: active ? '#f1f5f9' : '#475569',
                      borderRadius: 7,
                      padding: '8px',
                      fontSize: 12,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                    }}
                  >
                    {l}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.5, marginBottom: 6 }}>NOTE (optional)</div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any extra details..."
          style={{
            width: '100%',
            background: '#0d1420',
            border: '1px solid #1e2d45',
            color: '#e2e8f0',
            borderRadius: 7,
            padding: '9px 10px',
            fontSize: 13,
            marginBottom: 14,
          }}
        />

        <button
          onClick={submit}
          style={{
            width: '100%',
            background: '#1d4ed8',
            border: 'none',
            color: '#fff',
            borderRadius: 8,
            padding: '12px',
            fontWeight: 800,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Submit Report
        </button>
      </div>
    </div>
  )
}