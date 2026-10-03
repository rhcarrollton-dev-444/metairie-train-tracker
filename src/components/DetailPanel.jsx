import { useState } from 'react'
import StatTile, { ConfidenceTile } from './StatTile'
import CameraView from './CameraView'
import { statusBadge, formatEta, relativeTime } from '../lib/helpers'

// Expanded detail panel for a selected crossing (`Ep`): detection tiles, physics
// prediction, AI observation notes, email-alert subscription, and report button.
export default function DetailPanel({ crossing, detection, prop, onClose, onReport, alerts, setAlerts }) {
  const directMap = detection ? { [crossing.id]: detection } : {}
  const propMap = prop ? { [crossing.id]: prop } : {}
  const badge = statusBadge(crossing, directMap, propMap)

  const [email, setEmail] = useState(alerts[crossing.id] || '')
  const [subscribed, setSubscribed] = useState(!!alerts[crossing.id])
  const [showCamera, setShowCamera] = useState(false)

  const saveAlert = () => {
    if (!email.includes('@')) return
    setAlerts((prev) => ({ ...prev, [crossing.id]: email }))
    setSubscribed(true)
  }
  const removeAlert = () => {
    setAlerts((prev) => {
      const next = { ...prev }
      delete next[crossing.id]
      return next
    })
    setEmail('')
    setSubscribed(false)
  }

  return (
    <div
      style={{
        background: '#0d1420',
        border: `1px solid ${badge.border}55`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
        animation: 'slide-in 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>{crossing.name}</div>
          <div style={{ fontSize: 11, color: '#475569' }}>
            {crossing.dot ? `DOT #${crossing.dot} · ` : ''}{crossing.hasCamera ? '📷 Live JP camera' : '○ Physics prediction'}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: '#1e2d45', border: 'none', borderRadius: 6, width: 26, height: 26, color: '#94a3b8', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      {crossing.alias && (
        <>
          <button
            onClick={() => setShowCamera((s) => !s)}
            style={{
              width: '100%',
              marginBottom: 10,
              background: showCamera ? '#1a2535' : '#1e3a5f',
              border: '1px solid #3b82f6',
              color: '#60a5fa',
              borderRadius: 7,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showCamera ? 'Hide live camera' : '📷 View live camera'}
          </button>
          {showCamera && <CameraView alias={crossing.alias} name={crossing.name} />}
        </>
      )}

      {crossing.hasCamera && detection ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatTile
              label="Train Present"
              value={detection.train_present ? 'YES' : 'NO'}
              color={detection.train_present ? '#ef4444' : '#22c55e'}
            />
            <StatTile
              label="Crossing Blocked"
              value={detection.crossing_blocked ? 'BLOCKED' : 'CLEAR'}
              color={detection.crossing_blocked ? '#ef4444' : '#22c55e'}
            />
            <StatTile label="Direction" value={detection.direction || '—'} color="#60a5fa" />
            <StatTile
              label="Speed"
              value={detection.speed_estimate_mph ? `${detection.speed_estimate_mph} mph` : '—'}
              color="#f59e0b"
            />
            <StatTile
              label="Gates Down"
              value={detection.gates_down === null ? '—' : detection.gates_down ? 'YES' : 'NO'}
              color="#a78bfa"
            />
            <ConfidenceTile confidence={detection.confidence} />
          </div>
          {detection.notes && (
            <div style={{ background: '#0a1018', borderRadius: 6, padding: '8px 10px', marginTop: 10 }}>
              <div style={{ fontSize: 9, color: '#334155', letterSpacing: 0.5, marginBottom: 2 }}>AI OBSERVATION</div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>{detection.notes}</div>
            </div>
          )}
          <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>Analyzed {relativeTime(detection.fetchedAt)}</div>
        </>
      ) : !crossing.hasCamera && prop?.mode === 'clearing' ? (
        <div style={{ background: '#1a1530', border: '1px solid #7c3aed44', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginBottom: 6 }}>Train passing through</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {`A ${prop.direction} train already passed this crossing. It's clearing now — though a long train's tail may still be occupying it. The camera can't see this crossing directly, so there's no exact countdown.`}
          </div>
          <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>Detected {relativeTime(prop.propagatedAt)}</div>
        </div>
      ) : !crossing.hasCamera && prop?.mode === 'approaching' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatTile label="ETA" value={formatEta(prop.eta_mins)} color="#f97316" large />
            <StatTile label="Direction" value={prop.direction} color="#60a5fa" />
            <StatTile label="Speed" value={`${prop.speed_mph} mph`} color="#f59e0b" />
            <StatTile label="From Camera" value={prop.sourceName} color="#a78bfa" />
            <StatTile label="Distance" value={`${prop.distMiles.toFixed(2)} mi`} color="#94a3b8" />
            <ConfidenceTile confidence={prop.confidence} />
          </div>
          <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>
            Train heading {prop.direction} toward this crossing{prop.crossedJunction ? ' via Labarre junction' : ''} · detected {relativeTime(prop.propagatedAt)}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#334155' }}>
          No data yet.{' '}
          {crossing.hasCamera
            ? 'Press Scan Now to analyze.'
            : "Predictions appear when a train is detected at Metairie Rd."}
        </div>
      )}

      <button
        onClick={() => onReport(crossing)}
        style={{
          marginTop: 12,
          width: '100%',
          background: '#1e2d45',
          border: '1px solid #334155',
          color: '#94a3b8',
          borderRadius: 7,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        📝 Submit Community Report
      </button>

      <div style={{ background: '#0a1018', borderRadius: 8, padding: '10px 12px', marginTop: 10 }}>
        <div style={{ fontSize: 10, color: '#475569', letterSpacing: 0.5, marginBottom: 6 }}>🔔 EMAIL ALERTS FOR THIS CROSSING</div>
        {subscribed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12, color: '#86efac', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✓ Alerts → {alerts[crossing.id]}
            </span>
            <button
              onClick={removeAlert}
              style={{
                background: '#450a0a',
                border: '1px solid #ef444444',
                color: '#fca5a5',
                borderRadius: 5,
                fontSize: 11,
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAlert()}
              placeholder="your@email.com"
              style={{
                flex: 1,
                background: '#0d1420',
                border: '1px solid #1e2d45',
                color: '#e2e8f0',
                borderRadius: 6,
                padding: '7px 10px',
                fontSize: 12,
              }}
            />
            <button
              onClick={saveAlert}
              style={{ background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        )}
        <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>Alerts fire on train detection + all-clear. 30-min cooldown.</div>
      </div>
    </div>
  )
}