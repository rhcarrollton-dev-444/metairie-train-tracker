import { CORRIDOR, CLEAR_STREAK_REQUIRED } from '../data/crossings'
import AboutCard from './AboutCard'

// About tab (`Pp`): how detection works, community reports, alerts, crossings.
export default function About() {
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AboutCard title="Vision Detection">
        <ol style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.9, paddingLeft: 18 }}>
          <li>Serverless function resolves live snapshot URL from JP ipcamlive feed</li>
          <li>Snapshot fetched server-side (no CORS issues)</li>
          <li>Claude Sonnet Vision analyzes image → train present, direction, speed, gates, confidence</li>
          <li>Physics engine propagates ETAs to the 4 crossings without cameras</li>
          <li>
            After {CLEAR_STREAK_REQUIRED} consecutive clear scans → {'"ALL CLEAR"'} event fires
          </li>
        </ol>
      </AboutCard>

      <AboutCard title="Community Reports">
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          Tap 📝 on any crossing card or inside the detail panel to submit a report. Reports feed into the physics
          propagation engine alongside AI detections and are included in the heatmap history. Stored locally in your
          browser.
        </div>
      </AboutCard>

      <AboutCard title="Email Alerts">
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          Tap any crossing → expand detail panel → enter email to subscribe. Alerts fire on train detection and
          all-clear confirmation (30-min cooldown). Powered by Resend. Requires{' '}
          <code style={{ color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>RESEND_API_KEY</code> in Netlify
          env vars.
        </div>
      </AboutCard>

      <AboutCard title="Crossings">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {CORRIDOR.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 0',
                borderTop: i === 0 ? 'none' : '1px solid #111827',
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{c.name}</span>{' '}
                <span style={{ color: '#475569', fontSize: 10 }}>DOT #{c.dot}</span>
              </div>
              {c.hasCamera ? (
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#60a5fa' }}>{c.alias}</span>
              ) : (
                <span style={{ fontSize: 10, color: '#1e2d45' }}>{Math.abs(c.distFromMetairie).toFixed(2)} mi west</span>
              )}
            </div>
          ))}
        </div>
      </AboutCard>
    </div>
  )
}