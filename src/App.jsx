import { useState, useEffect, useRef, useCallback } from 'react'
import { CROSSINGS, CAMERA_CROSSING_ID } from './crossings.js'
import { runDetectionPipeline } from './api.js'
import { propagateETAs, formatETA } from './physics.js'

const SCAN_INTERVAL_MS = 10000 // 10 seconds

const styles = {
  app: { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header: { background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: '20px', fontWeight: '700', color: '#f8fafc', letterSpacing: '-0.3px' },
  subtitle: { fontSize: '12px', color: '#64748b', marginTop: '2px' },
  badge: (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600', background: color === 'green' ? '#166534' : color === 'red' ? '#7f1d1d' : color === 'yellow' ? '#713f12' : '#1e3a5f', color: color === 'green' ? '#bbf7d0' : color === 'red' ? '#fecaca' : color === 'yellow' ? '#fef08a' : '#93c5fd' }),
  container: { maxWidth: '900px', margin: '0 auto', padding: '20px' },
  section: { marginBottom: '24px' },
  sectionTitle: { fontSize: '13px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' },
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  crossingCard: (status) => ({ background: status === 'ACTIVE' ? '#1a2e1a' : status === 'INCOMING' ? '#1a1a2e' : '#1e293b', border: `1px solid ${status === 'ACTIVE' ? '#166534' : status === 'INCOMING' ? '#1e3a8a' : '#334155'}`, borderRadius: '12px', padding: '16px', marginBottom: '10px' }),
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  crossingName: { fontSize: '16px', fontWeight: '600', color: '#f1f5f9' },
  crossingDot: { fontSize: '12px', color: '#64748b', marginTop: '2px' },
  etaText: { fontSize: '14px', fontWeight: '600', color: '#60a5fa' },
  btn: (variant) => ({ padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: variant === 'primary' ? '#2563eb' : variant === 'danger' ? '#dc2626' : variant === 'success' ? '#16a34a' : '#334155', color: '#fff', transition: 'opacity 0.15s' }),
  snapshotImg: { width: '100%', borderRadius: '8px', border: '1px solid #334155', marginTop: '12px', maxHeight: '300px', objectFit: 'cover' },
  logEntry: { fontSize: '12px', color: '#94a3b8', padding: '4px 0', borderBottom: '1px solid #1e293b' },
  flex: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  confidence: (v) => ({ fontSize: '12px', color: v >= 0.8 ? '#86efac' : v >= 0.5 ? '#fde68a' : '#f87171' }),
}

export default function App() {
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState(null)
  const [detection, setDetection] = useState(null)
  const [snapshotSrc, setSnapshotSrc] = useState(null)
  const [etas, setEtas] = useState({})
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const intervalRef = useRef(null)

  const addLog = useCallback((msg, type = 'info') => {
    const entry = { msg, type, time: new Date().toLocaleTimeString() }
    setLog(prev => [entry, ...prev].slice(0, 50))
  }, [])

  const runScan = useCallback(async () => {
    const cameraCrossing = CROSSINGS.find(c => c.id === CAMERA_CROSSING_ID)
    setError(null)
    addLog('🔍 Fetching snapshot from Metairie Rd camera...')

    try {
      const { base64, analysis } = await runDetectionPipeline(cameraCrossing.cameraAlias)
      setSnapshotSrc(base64)
      setDetection(analysis)
      setLastScan(new Date())
      setScanCount(c => c + 1)

      if (analysis.train_present) {
        addLog(`🚂 TRAIN DETECTED — ${analysis.direction} @ ${analysis.speed_estimate_mph || '?'} mph (conf: ${Math.round((analysis.confidence || 0) * 100)}%)`, 'alert')
        const newEtas = propagateETAs(analysis.direction, analysis.speed_estimate_mph, new Date(), CROSSINGS)
        setEtas(newEtas)
      } else {
        addLog(`✅ Clear — no train detected (conf: ${Math.round((analysis.confidence || 0) * 100)}%)`, 'clear')
        setEtas({})
      }
    } catch (err) {
      setError(err.message)
      addLog(`❌ Error: ${err.message}`, 'error')
    }
  }, [addLog])

  const startAutoScan = useCallback(() => {
    setScanning(true)
    runScan()
    intervalRef.current = setInterval(runScan, SCAN_INTERVAL_MS)
  }, [runScan])

  const stopAutoScan = useCallback(() => {
    setScanning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
    addLog('⏹ Auto-scan stopped')
  }, [addLog])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const trainActive = detection?.train_present

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>🚂 Metairie Rail Tracker</div>
          <div style={styles.subtitle}>Vision-based AI detection · Norfolk Southern corridor</div>
        </div>
        <div style={styles.flex}>
          {scanning
            ? <span style={styles.badge('green')}>● LIVE</span>
            : <span style={styles.badge('gray')}>IDLE</span>
          }
          {trainActive && <span style={styles.badge('red')}>🚨 TRAIN</span>}
        </div>
      </div>

      <div style={styles.container}>

        {/* Controls */}
        <div style={{ ...styles.card, ...styles.flex, alignItems: 'center' }}>
          {!scanning
            ? <button style={styles.btn('primary')} onClick={startAutoScan}>▶ Start Auto-Scan</button>
            : <button style={styles.btn('danger')} onClick={stopAutoScan}>⏹ Stop</button>
          }
          <button style={styles.btn('secondary')} onClick={runScan} disabled={scanning}>🔍 Scan Now</button>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            {lastScan ? `Last scan: ${lastScan.toLocaleTimeString()}` : 'Not scanned yet'}
            {scanCount > 0 && ` · ${scanCount} scans`}
          </span>
        </div>

        {error && (
          <div style={{ ...styles.card, borderColor: '#7f1d1d', background: '#1a0a0a', color: '#fca5a5', fontSize: '13px' }}>
            ❌ {error}
          </div>
        )}

        {/* Detection Result */}
        {detection && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Detection Result</div>
            <div style={styles.card}>
              <div style={styles.row}>
                <div>
                  <span style={{ fontSize: '18px', fontWeight: '700', color: trainActive ? '#f87171' : '#86efac' }}>
                    {trainActive ? '🚨 TRAIN DETECTED' : '✅ CLEAR'}
                  </span>
                  {detection.direction && detection.direction !== 'none' && (
                    <span style={{ marginLeft: '10px', fontSize: '13px', color: '#94a3b8' }}>
                      {detection.direction === 'westbound' ? '← Westbound' : detection.direction === 'eastbound' ? '→ Eastbound' : '⏸ Stationary'}
                    </span>
                  )}
                </div>
                <span style={styles.confidence(detection.confidence)}>
                  {Math.round((detection.confidence || 0) * 100)}% confidence
                </span>
              </div>
              {detection.notes && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#94a3b8' }}>{detection.notes}</div>
              )}
              {detection.speed_estimate_mph && (
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#60a5fa' }}>
                  Speed estimate: ~{detection.speed_estimate_mph} mph
                </div>
              )}
              {snapshotSrc && <img src={snapshotSrc} alt="Camera snapshot" style={styles.snapshotImg} />}
            </div>
          </div>
        )}

        {/* Crossings */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Corridor Crossings — West to East</div>
          {CROSSINGS.map(crossing => {
            const eta = etas[crossing.id]
            const status = eta?.status || 'CLEAR'
            return (
              <div key={crossing.id} style={styles.crossingCard(status)}>
                <div style={styles.row}>
                  <div>
                    <div style={styles.crossingName}>{crossing.name}</div>
                    <div style={styles.crossingDot}>DOT #{crossing.dot} · {crossing.address}</div>
                    {crossing.cameraAlias && (
                      <div style={{ fontSize: '11px', color: '#22d3ee', marginTop: '2px' }}>📷 Camera monitored</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {status === 'ACTIVE' && <div style={styles.badge('red')}>🚨 ACTIVE</div>}
                    {status === 'INCOMING' && <div style={styles.badge('yellow')}>⚠️ INCOMING</div>}
                    {status === 'PASSED' && <div style={styles.badge('gray')}>PASSED</div>}
                    {status === 'CLEAR' && <div style={styles.badge('green')}>CLEAR</div>}
                    {eta && <div style={{ ...styles.etaText, marginTop: '4px' }}>{formatETA(eta)}</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Activity Log */}
        {log.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Activity Log</div>
            <div style={styles.card}>
              {log.map((entry, i) => (
                <div key={i} style={{ ...styles.logEntry, color: entry.type === 'alert' ? '#f87171' : entry.type === 'error' ? '#fca5a5' : entry.type === 'clear' ? '#86efac' : '#94a3b8' }}>
                  <span style={{ color: '#475569', marginRight: '8px' }}>{entry.time}</span>
                  {entry.msg}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: '12px', color: '#334155', marginTop: '24px' }}>
          Powered by Claude Vision · Scans every 10s · Physics-based ETA propagation
        </div>
      </div>
    </div>
  )
}
