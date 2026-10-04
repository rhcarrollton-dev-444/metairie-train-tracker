import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CORRIDOR, DOWNSTREAM, CLEAR_STREAK_REQUIRED, MAX_SCAN_LOG } from './data/crossings'
import {
  fetchSnapshotUrl,
  fetchSnapshotImage,
  analyzeVision,
  sendAlert,
  fetchStatus,
} from './lib/api'
import {
  propagate,
  statusBadge,
  formatEta,
  loadStorage,
  saveStorage,
  markServerPropagated,
} from './lib/helpers'
import { TOAST_LIFE_MS, STATUS_POLL_MS } from './lib/theme'

import Header from './components/Header'
import Tabs from './components/Tabs'
import CorridorView from './components/CorridorView'
import MapView from './components/MapView'
import Heatmap from './components/Heatmap'
import Log from './components/Log'
import About from './components/About'
import ReportModal from './components/ReportModal'
import Toasts from './components/Toasts'

export default function App() {
  const [detections, setDetections] = useState({})
  const [propagated, setPropagated] = useState({})
  const [scanLog, setScanLog] = useState(() => loadStorage('scanLog', []))
  const [reports, setReports] = useState(() => loadStorage('reports', []))
  const [alerts, setAlerts] = useState(() => loadStorage('alerts', {}))
  const [tab, setTab] = useState('corridor')
  const [selected, setSelected] = useState(null)
  const [reportTarget, setReportTarget] = useState(null)
  const [isPolling, setIsPolling] = useState(false)
  const [intervalSecs, setIntervalSecs] = useState(15)
  const [analyzing, setAnalyzing] = useState(false)
  const [errors, setErrors] = useState([])
  const [lastScan, setLastScan] = useState(null)
  const [toasts, setToasts] = useState([])
  const [serverStatus, setServerStatus] = useState(null)
  const [history, setHistory] = useState([])

  // Refs so async loops read the latest state without re-creating callbacks
  // (avoids stale-closure bugs in the scan loop + auto-scan interval).
  const detectionsRef = useRef(detections)
  const propagatedRef = useRef(propagated)
  const alertsRef = useRef(alerts)
  const analyzingRef = useRef(analyzing)
  // Write-only caches: snapshots and the consecutive-clear counter never drive
  // the UI directly (the deployed app stores them but never renders them), so
  // they're refs rather than state. Promote snapshots to state when we add a
  // live camera-image view (see BUGS.md).
  const snapshotsRef = useRef({})
  const clearCountsRef = useRef({})
  const runScanRef = useRef(() => {})
  useEffect(() => void (detectionsRef.current = detections), [detections])
  useEffect(() => void (propagatedRef.current = propagated), [propagated])
  useEffect(() => void (alertsRef.current = alerts), [alerts])
  useEffect(() => void (analyzingRef.current = analyzing), [analyzing])
  const intervalRef = useRef(null)

  // --- persistence ---
  useEffect(() => saveStorage('scanLog', scanLog.slice(0, MAX_SCAN_LOG)), [scanLog])
  useEffect(() => saveStorage('reports', reports.slice(0, 200)), [reports])
  useEffect(() => saveStorage('alerts', alerts), [alerts])

  // --- toasts ---
  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_LIFE_MS)
  }, [])

  // --- email alerts ---
  const sendAlertFor = useCallback(
    async (crossing, eventType, detection, etaMins) => {
      const email = alertsRef.current[crossing.id]
      if (!email) return
      try {
        await sendAlert({
          email,
          crossingId: crossing.id,
          crossingName: crossing.name,
          eventType,
          direction: detection?.direction,
          speed: detection?.speed_estimate_mph,
          eta: etaMins != null ? formatEta(etaMins) : null,
          notes: detection?.notes,
        })
        toast(`Alert sent to ${email}`, 'success')
      } catch (err) {
        if (err.message.includes('Cooldown')) return // server-enforced 30-min cooldown
        toast(`Alert failed: ${err.message}`, 'error')
      }
    },
    [toast]
  )

  // --- scan loop ---
  const runScan = useCallback(async () => {
    if (analyzingRef.current) return
    setAnalyzing(true)
    setErrors([])
    const errs = []
    const targets = CORRIDOR.filter((c) => c.hasCamera && c.alias)

    for (const T of targets) {
      try {
        const { online, snapshotUrl } = await fetchSnapshotUrl(T.alias)
        if (!online || !snapshotUrl) {
          errs.push(`${T.name}: camera offline`)
          continue
        }
        snapshotsRef.current = {
          ...snapshotsRef.current,
          [T.id]: { url: snapshotUrl, fetchedAt: Date.now() },
        }

        const { base64, mediaType } = await fetchSnapshotImage(snapshotUrl)
        const result = await analyzeVision({ base64, mediaType, crossingId: T.id, crossingName: T.name })
        const detection = { ...result, fetchedAt: Date.now() }

        const prevTrain = detectionsRef.current[T.id]?.train_present
        setDetections((prev) => ({ ...prev, [T.id]: detection }))
        if (detection.train_present && !prevTrain) sendAlertFor(T, 'train_detected', detection, null)

        if (detection.train_present) {
          const propagatedNow = propagate(detection, T)
          // Merge, don't replace: keep server-propagated and community-propagated
          // entries for OTHER sources; this source's entries are replaced below.
          setPropagated((prev) => {
            const next = {}
            for (const [k, v] of Object.entries(prev)) if (v.sourceId !== T.id) next[k] = v
            return { ...next, ...propagatedNow }
          })
          clearCountsRef.current = { ...clearCountsRef.current, [T.id]: 0 }
          for (const [id, entry] of Object.entries(propagatedNow)) {
            const crossing = CORRIDOR.find((c) => c.id === id)
            if (crossing) sendAlertFor(crossing, 'train_detected', detection, entry.eta_mins)
          }
        } else {
          const next = { ...clearCountsRef.current, [T.id]: (clearCountsRef.current[T.id] || 0) + 1 }
          clearCountsRef.current = next
          if (next[T.id] === CLEAR_STREAK_REQUIRED) {
            const hasPropagated = Object.values(propagatedRef.current).some((x) => x.sourceId === T.id)
            if (hasPropagated) {
              sendAlertFor(T, 'train_cleared', null, null)
              toast(`✓ ${T.name} confirmed clear`, 'success')
              setPropagated((p) => {
                const cleaned = {}
                for (const [k, v] of Object.entries(p)) if (v.sourceId !== T.id) cleaned[k] = v
                return cleaned
              })
            }
          }
        }

        const record = {
          id: `${T.id}-${Date.now()}`,
          crossingId: T.id,
          crossingName: T.short,
          train_present: detection.train_present,
          crossing_blocked: detection.crossing_blocked,
          direction: detection.direction,
          speed_estimate_mph: detection.speed_estimate_mph,
          confidence: detection.confidence,
          notes: detection.notes,
          ts: Date.now(),
        }
        setScanLog((prev) => [record, ...prev.slice(0, MAX_SCAN_LOG - 1)])
      } catch (err) {
        errs.push(`${T.name}: ${err.message}`)
      }
    }

    if (errs.length) setErrors(errs)
    setLastScan(Date.now())
    setAnalyzing(false)
  }, [sendAlertFor, toast])

  useEffect(() => {
    runScanRef.current = runScan
  }, [runScan])

  // --- auto-scan interval ---
  useEffect(() => {
    if (!isPolling) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
      return
    }
    runScanRef.current()
    intervalRef.current = setInterval(() => runScanRef.current(), intervalSecs * 1000)
    return () => clearInterval(intervalRef.current)
  }, [isPolling, intervalSecs])

  // --- server status polling ---
  useEffect(() => {
    let canceled = false
    const poll = async () => {
      try {
        const { latest, history: hist } = await fetchStatus({ history: true })
        if (canceled) return
        if (Array.isArray(hist)) setHistory(hist)
        if (!latest) return
        setServerStatus(latest)
        if (latest.metairie) {
          setDetections((prev) => ({ ...prev, metairie: { ...latest.metairie, fetchedAt: latest.checkedAt } }))
        }
        if (latest.propagated && Object.keys(latest.propagated).length) {
          setPropagated((prev) => ({ ...prev, ...markServerPropagated(latest.propagated, latest.checkedAt) }))
        }
        // Per-source cleanup: when a source camera is clear, drop only the entries
        // that SOURCE propagated (keyed on propagated entry's sourceId), not the
        // whole server-propagated set.
        const sources = [latest.metairie, latest.labarre]
        for (const src of sources) {
          const srcId = src?.crossingId || (src === latest.metairie ? 'metairie' : 'labarre')
          const srcTrain = !!src?.train_present
          if (src && srcId && !srcTrain) {
            setPropagated((prev) => {
              const next = {}
              let dropped = false
              for (const [k, v] of Object.entries(prev)) {
                if (v.fromServer && v.sourceId === srcId) { dropped = true; continue }
                next[k] = v
              }
              return dropped ? next : prev
            })
          }
        }
      } catch {
        /* swallow */
      }
    }
    poll()
    const id = setInterval(poll, STATUS_POLL_MS)
    return () => {
      canceled = true
      clearInterval(id)
    }
  }, [])

  // --- community report ---
  const submitReport = useCallback(
    (report) => {
      const rec = { ...report, id: Date.now(), ts: Date.now(), source: 'community' }
      setReports((prev) => [rec, ...prev.slice(0, 199)])
      toast(`Report submitted for ${report.crossingName}`, 'success')
      setReportTarget(null)

      const T = CORRIDOR.find((c) => c.id === report.crossingId) ||
                DOWNSTREAM.find((c) => c.id === report.crossingId)

      if (!report.train_present) {
        // All-clear report: drop this crossing's propagated entries and, if the
        // reporter is at the SOURCE camera crossing, fire train_cleared for it.
        setPropagated((prev) => {
          const next = {}
          for (const [k, v] of Object.entries(prev)) {
            if (k === report.crossingId || v.sourceId === report.crossingId) continue
            next[k] = v
          }
          return next
        })
        if (T && T.hasCamera) {
          const hasPropagated = Object.values(propagatedRef.current).some((x) => x.sourceId === T.id)
          if (hasPropagated) {
            sendAlertFor(T, 'train_cleared', null, null)
            toast(`✓ ${T.name} all-clear confirmed`, 'success')
          }
        }
        return
      }

      if (T && T.distFromMetairie != null) {
        const fakeDet = {
          train_present: true,
          direction: report.direction,
          speed_estimate_mph: report.speed_mph || null,
          confidence: 0.7,
        }
        const propagatedNow = propagate(fakeDet, T)
        setPropagated((prev) => ({ ...prev, ...propagatedNow }))

        // Fire alerts for all propagated crossings
        for (const [id, entry] of Object.entries(propagatedNow)) {
          const crossing = CORRIDOR.find((c) => c.id === id) ||
                          DOWNSTREAM.find((c) => c.id === id)
          if (crossing) {
            sendAlertFor(crossing, 'train_detected', fakeDet, entry.eta_mins)
          }
        }
        sendAlertFor(T, 'train_detected', fakeDet, null)
      } else if (T) {
        // No propagation possible (no distance on this corridor), but the report
        // itself is a sighting at that crossing — fire its own alert.
        sendAlertFor(T, 'train_detected', {
          train_present: true,
          direction: report.direction,
          speed_estimate_mph: report.speed_mph || null,
          confidence: 0.7,
          notes: 'from community report',
        }, null)
      }
    },
    [toast, sendAlertFor]
  )

  const anyUrgent = CORRIDOR.some((c) => statusBadge(c, detections, propagated).urgent)

  // Combined heatmap history: server history + local scan log + community reports.
  // Dedup by (crossingId, second-bucket, report-flag) so a scan that appears in BOTH the
  // server history and the local scanLog (e.g. an analyze-vision call the server also
  // persisted) is counted once. Reports are kept on a separate key so they never collide
  // with scans.
  const combinedHistory = useMemo(() => {
    const merged = [
      ...history.map((r) => ({ ...r, id: r.id || `srv-${r.ts}-${r.crossingId}`, fromServer: true })),
      ...scanLog,
      ...reports.map((r) => ({ ...r, fromReport: true })),
    ]
    const seen = new Set()
    const out = []
    for (const r of merged) {
      if (r.ts == null || r.crossingId == null) {
        out.push(r)
        continue
      }
      const key = `${r.crossingId}|${Math.floor(r.ts / 1000)}|${r.fromReport ? 1 : 0}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
    return out
  }, [history, scanLog, reports])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#080b10' }}>
      <Header
        anyUrgent={anyUrgent}
        analyzing={analyzing}
        lastScan={lastScan}
        isPolling={isPolling}
        intervalSecs={intervalSecs}
        serverStatus={serverStatus}
      />
      <Tabs tab={tab} setTab={setTab} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'corridor' && (
          <CorridorView
            detections={detections}
            propagated={propagated}
            analyzing={analyzing}
            isPolling={isPolling}
            intervalSecs={intervalSecs}
            errors={errors}
            selected={selected}
            setSelected={setSelected}
            onScan={runScan}
            onTogglePolling={() => setIsPolling((p) => !p)}
            onSetInterval={setIntervalSecs}
            onReport={(c) => setReportTarget(c)}
            alerts={alerts}
            setAlerts={setAlerts}
            serverStatus={serverStatus}
          />
        )}
        {tab === 'map' && (
          <MapView
            detections={detections}
            propagated={propagated}
            serverStatus={serverStatus}
            history={combinedHistory}
            onSelect={(c) => {
              setSelected(c)
              setTab('corridor')
            }}
          />
        )}
        {tab === 'heatmap' && <Heatmap history={combinedHistory} />}
        {tab === 'log' && <Log scanLog={scanLog} reports={reports} />}
        {tab === 'about' && <About />}
      </div>

      {reportTarget && (
        <ReportModal crossing={reportTarget} onSubmit={submitReport} onClose={() => setReportTarget(null)} />
      )}
      <Toasts toasts={toasts} />
    </div>
  )
}