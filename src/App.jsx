import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CROSSINGS, WATCH_CAMERAS } from "./crossings.js";
import { getSnapshotUrl, getSnapshotImage, analyzeVision, sendAlert, getStatus } from "./api.js";
import { propagate } from "./physics.js";
import { timeAgo, etaLabel, confidenceBadge, crossingStatus } from "./utils.js";

// ── Storage helpers ───────────────────────────────────────────────────────────
function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Normalize server propagation objects to the shape the UI expects
function mapPropagated(serverProp, checkedAt) {
  const out = {};
  for (const [cid, p] of Object.entries(serverProp)) {
    out[cid] = {
      ...p,
      sourceId: "metairie",
      propagatedAt: checkedAt || Date.now(),
      fromServer: true,
    };
  }
  return out;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CLEAR_CONFIRM_SCANS = 3; // consecutive clear scans before "ALL CLEAR" event
const MAX_HISTORY = 500;       // max scan records kept for heatmap

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [detections,    setDetections]    = useState({});
  const [propagated,    setPropagated]    = useState({});
  const [snapshots,     setSnapshots]     = useState({});
  const [scanLog,       setScanLog]       = useState(() => loadLS("scanLog", []));
  const [reports,       setReports]       = useState(() => loadLS("reports", []));
  const [alerts,        setAlerts]        = useState(() => loadLS("alerts", {})); // crossingId → email
  const [tab,           setTab]           = useState("corridor");
  const [selected,      setSelected]      = useState(null);
  const [reportTarget,  setReportTarget]  = useState(null);
  const [isPolling,     setIsPolling]     = useState(false);
  const [intervalSecs,  setIntervalSecs]  = useState(15);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [errors,        setErrors]        = useState([]);
  const [lastScan,      setLastScan]      = useState(null);
  const [clearCounts,   setClearCounts]   = useState({}); // crossingId → consecutive clear count
  const [toasts,        setToasts]        = useState([]);
  const [serverStatus,  setServerStatus]  = useState(null); // latest cron scan from server
  const [serverHistory, setServerHistory] = useState([]);   // all-day cron scan history
  const pollerRef = useRef(null);

  // Persist scan log + reports + alerts
  useEffect(() => saveLS("scanLog", scanLog.slice(0, MAX_HISTORY)), [scanLog]);
  useEffect(() => saveLS("reports", reports.slice(0, 200)), [reports]);
  useEffect(() => saveLS("alerts", alerts), [alerts]);

  // ── Load server cron status on mount + refresh every 60s ────────────────────
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const { latest, history } = await getStatus({ history: true });
        if (cancelled) return;
        if (Array.isArray(history)) setServerHistory(history);
        if (!latest) return;
        setServerStatus(latest);
        // Seed live state from the server scan so the app shows a train immediately
        if (latest.metairie) {
          setDetections(prev => ({ ...prev, metairie: { ...latest.metairie, fetchedAt: latest.checkedAt } }));
        }
        if (latest.propagated && Object.keys(latest.propagated).length) {
          setPropagated(prev => ({ ...prev, ...mapPropagated(latest.propagated, latest.checkedAt) }));
        }
        if (!latest.metairie?.train_present) {
          // server says clear — clear stale propagation from server source
          setPropagated(prev => {
            const n = { ...prev };
            Object.keys(n).forEach(k => { if (n[k]?.fromServer) delete n[k]; });
            return n;
          });
        }
      } catch { /* server status optional */ }
    }
    pull();
    const t = setInterval(pull, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const toast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  // ── Fire alerts ─────────────────────────────────────────────────────────────
  const fireAlert = useCallback(async (crossing, eventType, detection, eta) => {
    const email = alerts[crossing.id];
    if (!email) return;
    try {
      await sendAlert({
        email,
        crossingId: crossing.id,
        crossingName: crossing.name,
        eventType,
        direction: detection?.direction,
        speed: detection?.speed_estimate_mph,
        eta: eta ? etaLabel(eta) : null,
        notes: detection?.notes,
      });
      toast(`Alert sent to ${email}`, "success");
    } catch (e) {
      // Cooldown errors are silent — expected
      if (!e.message?.includes("Cooldown")) toast(`Alert failed: ${e.message}`, "error");
    }
  }, [alerts, toast]);

  // ── Core scan cycle ─────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setErrors([]);
    const errs = [];
    const cameraCrossings = CROSSINGS.filter(c => c.hasCamera && c.alias);

    for (const crossing of cameraCrossings) {
      try {
        const { online, snapshotUrl } = await getSnapshotUrl(crossing.alias);
        if (!online || !snapshotUrl) { errs.push(`${crossing.name}: camera offline`); continue; }

        setSnapshots(prev => ({ ...prev, [crossing.id]: { url: snapshotUrl, fetchedAt: Date.now() } }));

        const { base64, mediaType } = await getSnapshotImage(snapshotUrl);
        const detection = await analyzeVision({ base64, mediaType, crossingId: crossing.id, crossingName: crossing.name });
        const detWithTs = { ...detection, fetchedAt: Date.now() };

        setDetections(prev => {
          const wasPresent = prev[crossing.id]?.train_present;
          // Train appeared
          if (detection.train_present && !wasPresent) fireAlert(crossing, "train_detected", detection, null);
          return { ...prev, [crossing.id]: detWithTs };
        });

        // Physics propagation
        if (detection.train_present) {
          const props = propagate(detection, crossing);
          setPropagated(props);
          setClearCounts(p => ({ ...p, [crossing.id]: 0 }));
          // Fire alerts for propagated crossings
          Object.entries(props).forEach(([cid, prop]) => {
            const c = CROSSINGS.find(x => x.id === cid);
            if (c) fireAlert(c, "train_detected", detection, prop.eta_mins);
          });
        } else {
          // Count consecutive clear scans
          setClearCounts(prev => {
            const next = { ...prev, [crossing.id]: (prev[crossing.id] || 0) + 1 };
            if (next[crossing.id] === CLEAR_CONFIRM_SCANS) {
              // Confirmed clear
              const wasActive = Object.values(propagated).some(p => p.sourceId === crossing.id);
              if (wasActive) {
                fireAlert(crossing, "train_cleared", null, null);
                toast(`✓ ${crossing.name} confirmed clear`, "success");
              }
              setPropagated(p => {
                const n = { ...p };
                Object.keys(n).forEach(k => { if (n[k]?.sourceId === crossing.id) delete n[k]; });
                return n;
              });
            }
            return next;
          });
        }

        // Append to scan log (for heatmap)
        const record = {
          id: `${crossing.id}-${Date.now()}`,
          crossingId: crossing.id,
          crossingName: crossing.short,
          train_present: detection.train_present,
          crossing_blocked: detection.crossing_blocked,
          direction: detection.direction,
          speed_estimate_mph: detection.speed_estimate_mph,
          confidence: detection.confidence,
          notes: detection.notes,
          ts: Date.now(),
        };
        setScanLog(prev => [record, ...prev.slice(0, MAX_HISTORY - 1)]);

      } catch (e) {
        errs.push(`${crossing.name}: ${e.message}`);
      }
    }

    if (errs.length) setErrors(errs);
    setLastScan(Date.now());
    setAnalyzing(false);
  }, [analyzing, alerts, propagated, fireAlert, toast]);

  // ── Polling ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPolling) {
      runScan();
      pollerRef.current = setInterval(runScan, intervalSecs * 1000);
    } else {
      clearInterval(pollerRef.current);
    }
    return () => clearInterval(pollerRef.current);
  }, [isPolling, intervalSecs]); // eslint-disable-line

  // ── Community report handler ─────────────────────────────────────────────────
  const submitReport = useCallback((report) => {
    const rec = { ...report, id: Date.now(), ts: Date.now(), source: "community" };
    setReports(prev => [rec, ...prev.slice(0, 199)]);
    toast(`Report submitted for ${report.crossingName}`, "success");
    setReportTarget(null);
    // If train reported, also propagate
    if (report.train_present) {
      const crossing = CROSSINGS.find(c => c.id === report.crossingId);
      if (crossing) {
        const fakeDetection = {
          train_present: true,
          direction: report.direction,
          speed_estimate_mph: report.speed_mph || null,
          confidence: 0.7,
        };
        const props = propagate(fakeDetection, crossing);
        setPropagated(prev => ({ ...prev, ...props }));
        // Fire alerts for propagated crossings
        Object.entries(props).forEach(([cid, prop]) => {
          const c = CROSSINGS.find(x => x.id === cid);
          if (c) fireAlert(c, "train_detected", fakeDetection, prop.eta_mins);
        });
        // Alert for the source crossing too
        fireAlert(crossing, "train_detected", fakeDetection, null);
      }
    }
  }, [toast, fireAlert]);

  const anyUrgent = CROSSINGS.some(c => crossingStatus(c, detections, propagated).urgent);

  // Merge server cron history + local scan log + community reports for heatmap.
  // De-dupe by id where present; server history is the bulk of the data.
  const allHistory = [
    ...serverHistory.map(r => ({ ...r, id: r.id || `srv-${r.ts}-${r.crossingId}`, fromServer: true })),
    ...scanLog,
    ...reports.map(r => ({ ...r, fromReport: true })),
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#080b10", display:"flex", flexDirection:"column" }}>
      <Header anyUrgent={anyUrgent} analyzing={analyzing} lastScan={lastScan} isPolling={isPolling} intervalSecs={intervalSecs} serverStatus={serverStatus} />
      <TabBar tab={tab} setTab={setTab} />

      <div style={{ flex:1, overflowY:"auto" }}>
        {tab === "corridor" && (
          <CorridorTab
            detections={detections} propagated={propagated} snapshots={snapshots}
            analyzing={analyzing} isPolling={isPolling} intervalSecs={intervalSecs}
            errors={errors} selected={selected} setSelected={setSelected}
            onScan={runScan} onTogglePolling={() => setIsPolling(p => !p)}
            onSetInterval={setIntervalSecs} onReport={setReportTarget}
            alerts={alerts} setAlerts={setAlerts}
            serverStatus={serverStatus}
          />
        )}
        {tab === "heatmap"  && <HeatmapTab history={allHistory} />}
        {tab === "log"      && <LogTab scanLog={scanLog} reports={reports} />}
        {tab === "about"    && <AboutTab />}
      </div>

      {/* Report modal */}
      {reportTarget && (
        <ReportModal crossing={reportTarget} onSubmit={submitReport} onClose={() => setReportTarget(null)} />
      )}

      {/* Toasts */}
      <div style={{ position:"fixed", bottom:16, left:"50%", transform:"translateX(-50%)", zIndex:999,
                    display:"flex", flexDirection:"column", gap:6, alignItems:"center", pointerEvents:"none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === "success" ? "#052e16" : t.type === "error" ? "#450a0a" : "#0c1a2e",
            border: `1px solid ${t.type === "success" ? "#16a34a" : t.type === "error" ? "#ef4444" : "#3b82f6"}`,
            color: t.type === "success" ? "#86efac" : t.type === "error" ? "#fca5a5" : "#93c5fd",
            padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600,
            animation:"slide-in 0.2s ease", boxShadow:"0 4px 20px #00000080",
          }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
export function Header({ anyUrgent, analyzing, lastScan, isPolling, intervalSecs, serverStatus }) {
  const serverAgo = serverStatus?.checkedAt ? timeAgo(serverStatus.checkedAt) : null;
  return (
    <div style={{ background:"linear-gradient(180deg,#0f172a 0%,#080b10 100%)", borderBottom:"1px solid #1e2d45", padding:"14px 16px 10px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
        <div style={{
          width:34, height:34, borderRadius:8, flexShrink:0,
          background: anyUrgent ? "#ef4444" : "#1e3a5f",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
          boxShadow: anyUrgent ? "0 0 18px #ef444480" : "none",
          transition:"all 0.4s", animation: anyUrgent ? "glow-red 2s infinite" : "none",
        }}>🚂</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:17, fontWeight:800, letterSpacing:"-0.3px", color:"#f1f5f9", lineHeight:1.2 }}>Metairie Rail Tracker</div>
          <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.6px", marginTop:1 }}>OLD METAIRIE CORRIDOR · NORFOLK SOUTHERN</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
          {analyzing && (
            <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#60a5fa" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#3b82f6", animation:"pulse-dot 1s infinite" }} />
              SCANNING
            </div>
          )}
          {isPolling && !analyzing && <div style={{ fontSize:10, color:"#22c55e" }}>▶ AUTO {intervalSecs}s</div>}
          {lastScan && !analyzing && <div style={{ fontSize:10, color:"#334155" }}>{timeAgo(lastScan)}</div>}
        </div>
      </div>
      <div style={{
        padding:"7px 10px", borderRadius:6,
        background: anyUrgent ? "#450a0a" : "#052e16",
        border:`1px solid ${anyUrgent ? "#ef444455" : "#16a34a44"}`,
        display:"flex", alignItems:"center", gap:8,
        fontSize:11, fontWeight:700, letterSpacing:"0.3px",
        color: anyUrgent ? "#fca5a5" : "#86efac",
      }}>
        <div style={{
          width:7, height:7, borderRadius:"50%",
          background: anyUrgent ? "#ef4444" : "#22c55e",
          boxShadow: anyUrgent ? "0 0 8px #ef4444" : "0 0 6px #22c55e",
          animation: anyUrgent ? "pulse-dot 1.2s infinite" : "none", flexShrink:0,
        }} />
        <span>{anyUrgent ? "⚠  TRAIN ACTIVITY ON CORRIDOR" : "✓  ALL CROSSINGS CLEAR"}</span>
        {serverAgo && (
          <span style={{ marginLeft:"auto", fontWeight:400, fontSize:10, color: anyUrgent ? "#fca5a588" : "#86efac88" }}>
            auto-checked {serverAgo}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────────────────
export function TabBar({ tab, setTab }) {
  const tabs = [
    { id:"corridor", label:"🗺 Corridor" },
    { id:"heatmap",  label:"🔥 Heatmap" },
    { id:"log",      label:"📋 Log" },
    { id:"about",    label:"ℹ About" },
  ];
  return (
    <div style={{ display:"flex", borderBottom:"1px solid #1e2d45", background:"#0a0e16" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex:1, background:"none", border:"none", cursor:"pointer",
          padding:"10px 2px", fontSize:10, fontWeight:700, letterSpacing:"0.3px",
          color: tab === t.id ? "#60a5fa" : "#475569",
          borderBottom: tab === t.id ? "2px solid #3b82f6" : "2px solid transparent",
          transition:"color 0.15s",
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Corridor tab
// ─────────────────────────────────────────────────────────────────────────────
export function CorridorTab({
  detections, propagated, snapshots, analyzing, isPolling, intervalSecs,
  errors, selected, setSelected, onScan, onTogglePolling, onSetInterval,
  onReport, alerts, setAlerts, serverStatus,
}) {
  const [showControls, setShowControls] = useState(false);
  const cameraCrossings = CROSSINGS.filter(c => c.hasCamera);
  const otherCrossings  = [...CROSSINGS].filter(c => !c.hasCamera).reverse();
  // Are any no-camera crossings showing a live prediction right now?
  const anyPrediction = otherCrossings.some(c => propagated[c.id]);
  const anyApproaching = otherCrossings.some(c => propagated[c.id]?.mode === "approaching");
  const anyClearing = otherCrossings.some(c => propagated[c.id]?.mode === "clearing");
  const downstreamNote = anyApproaching ? "train approaching"
    : anyClearing ? "train passing through"
    : "predicted from Metairie Rd";

  return (
    <div style={{ padding:14 }}>
      {/* Featured: the live camera crossing(s) */}
      {cameraCrossings.map(c => (
        <CrossingCard
          key={c.id} crossing={c}
          detection={detections[c.id]} prop={propagated[c.id]}
          isSelected={selected?.id === c.id}
          onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
          onReport={() => onReport(c)}
          featured
        />
      ))}

      {/* Detail panel appears right under the selected crossing */}
      {selected && (
        <DetailPanel
          crossing={selected} detection={detections[selected.id]}
          prop={propagated[selected.id]} snapshot={snapshots[selected.id]}
          onClose={() => setSelected(null)} onReport={onReport}
          alerts={alerts} setAlerts={setAlerts}
        />
      )}

      {/* Quiet section: downstream crossings (no camera) */}
      <div style={{ marginTop:16, marginBottom:8, fontSize:10, color:"#475569", letterSpacing:"0.6px", display:"flex", alignItems:"center", gap:8 }}>
        <span>DOWNSTREAM CROSSINGS</span>
        <div style={{ flex:1, height:1, background:"#1a2435" }} />
        <span style={{ color:"#334155", fontWeight:400, letterSpacing:0 }}>
          {downstreamNote}
        </span>
      </div>
      <div style={{ display:"grid", gap:6 }}>
        {otherCrossings.map(c => (
          <CrossingRow
            key={c.id} crossing={c}
            prop={propagated[c.id]}
            isSelected={selected?.id === c.id}
            onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
          />
        ))}
      </div>

      {/* Watch cameras — other JP cameras we scan for data collection */}
      <WatchCameras serverStatus={serverStatus} />

      {/* Manual controls — collapsed by default since scanning is automatic */}
      <button onClick={() => setShowControls(v => !v)} style={{
        marginTop:16, width:"100%", background:"none", border:"1px solid #1a2435",
        borderRadius:8, color:"#475569", padding:"8px", fontSize:11, fontWeight:600, cursor:"pointer",
      }}>
        {showControls ? "Hide manual scan" : "Manual scan & settings"}
      </button>
      {showControls && (
        <div style={{ marginTop:8 }}>
          <Controls
            analyzing={analyzing} isPolling={isPolling} intervalSecs={intervalSecs}
            onScan={onScan} onTogglePolling={onTogglePolling} onSetInterval={onSetInterval}
          />
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop:10, padding:"10px 12px", background:"#2d0a0a", border:"1px solid #ef444433", borderRadius:8 }}>
          {errors.map((e,i) => (
            <div key={i} style={{ fontSize:11, color:"#fca5a5", marginBottom: i < errors.length-1 ? 4 : 0 }}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watch cameras — other JP rail cameras scanned for data collection
// ─────────────────────────────────────────────────────────────────────────────
function WatchCameras({ serverStatus }) {
  const [open, setOpen] = useState(false);
  const cams = serverStatus?.cameras || {};
  const anyData = WATCH_CAMERAS.some(w => cams[w.id]);
  const trainsNow = WATCH_CAMERAS.filter(w => cams[w.id]?.train_present).length;

  return (
    <div style={{ marginTop:16 }}>
      <div style={{ marginBottom:8, fontSize:10, color:"#475569", letterSpacing:"0.6px", display:"flex", alignItems:"center", gap:8 }}>
        <span>WATCH CAMERAS</span>
        <div style={{ flex:1, height:1, background:"#1a2435" }} />
        <span style={{ color:"#334155", fontWeight:400, letterSpacing:0 }}>
          {trainsNow > 0 ? `${trainsNow} showing a train` : "data collection"}
        </span>
      </div>

      {!anyData ? (
        <div style={{ fontSize:11, color:"#334155", padding:"4px 2px" }}>
          Waiting for the next automatic scan to populate camera data…
        </div>
      ) : (
        <div style={{ display:"grid", gap:6 }}>
          {WATCH_CAMERAS.map(w => {
            const d = cams[w.id];
            const offline = !d || d.online === false;
            const train = d?.train_present;
            const dotColor = offline ? "#2d3a4f" : train ? "#ef4444" : "#22c55e";
            const label = offline ? "—" : train ? "TRAIN" : "Clear";
            const labelColor = offline ? "#475569" : train ? "#ef4444" : "#22c55e";
            return (
              <div key={w.id} style={{
                background: train ? "#1a0d0d" : "#0b111c",
                border:`1px solid ${train ? "#ef444455" : "#161f30"}`,
                borderRadius:10, padding:"9px 14px",
                display:"flex", alignItems:"center", gap:12,
              }}>
                <StatusDot color={dotColor} pulse={train} size={9} />
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontWeight:600, color: offline ? "#475569" : "#e2e8f0", fontSize:13 }}>{w.name}</span>
                  <span style={{ fontSize:10, color:"#3a4a63", marginLeft:8 }}>{w.area}</span>
                  {train && d?.notes && (
                    <div style={{ fontSize:10, color:"#94a3b8", marginTop:2, fontStyle:"italic", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.notes}</div>
                  )}
                </div>
                <div style={{ fontSize:12, fontWeight:700, color:labelColor, flexShrink:0 }}>{label}</div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize:9, color:"#283548", marginTop:8, lineHeight:1.5 }}>
        These cameras are scanned to learn which ones correlate with the Old Metairie corridor.
        Once the data shows the pattern, unrelated cameras can be dropped.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────
function DetailPanel({ crossing, detection, prop, onClose, onReport, alerts, setAlerts }) {
  const st = crossingStatus(crossing, detection ? { [crossing.id]: detection } : {}, prop ? { [crossing.id]: prop } : {});
  const [emailInput, setEmailInput] = useState(alerts[crossing.id] || "");
  const [alertSaved, setAlertSaved] = useState(!!alerts[crossing.id]);

  function saveAlert() {
    if (!emailInput.includes("@")) return;
    setAlerts(prev => ({ ...prev, [crossing.id]: emailInput }));
    setAlertSaved(true);
  }
  function clearAlert() {
    setAlerts(prev => { const n = { ...prev }; delete n[crossing.id]; return n; });
    setEmailInput("");
    setAlertSaved(false);
  }

  return (
    <div style={{ background:"#0d1420", border:`1px solid ${st.border}55`, borderRadius:10, padding:14, marginBottom:12, animation:"slide-in 0.15s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:15, color:"#f1f5f9" }}>{crossing.name}</div>
          <div style={{ fontSize:11, color:"#475569", marginTop:1 }}>DOT #{crossing.dot} · {crossing.hasCamera ? "📷 Live JP camera" : "○ Physics prediction"}</div>
        </div>
        <button onClick={onClose} style={{ background:"#1e2d45", border:"none", borderRadius:5, color:"#94a3b8", cursor:"pointer", width:26, height:26, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
      </div>

      {/* Detection stats */}
      {crossing.hasCamera && detection && (
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
            <Stat label="Train Present"    value={detection.train_present ? "YES" : "NO"}           color={detection.train_present ? "#ef4444" : "#22c55e"} />
            <Stat label="Crossing Blocked" value={detection.crossing_blocked ? "BLOCKED" : "CLEAR"} color={detection.crossing_blocked ? "#ef4444" : "#22c55e"} />
            <Stat label="Direction"        value={detection.direction || "—"}                        color="#60a5fa" />
            <Stat label="Speed"            value={detection.speed_estimate_mph ? `${detection.speed_estimate_mph} mph` : "—"} color="#f59e0b" />
            <Stat label="Gates Down"       value={detection.gates_down === null ? "—" : detection.gates_down ? "YES" : "NO"} color="#a78bfa" />
            <Stat label="Confidence"       value={detection.confidence ? `${Math.round(detection.confidence * 100)}%` : "—"} color={confidenceBadge(detection.confidence).color} />
          </div>
          {detection.notes && (
            <div style={{ background:"#0a1018", borderRadius:6, padding:"8px 10px", marginBottom:6 }}>
              <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.5px", marginBottom:3 }}>AI OBSERVATION</div>
              <div style={{ fontSize:12, color:"#94a3b8", fontStyle:"italic", lineHeight:1.5 }}>{detection.notes}</div>
            </div>
          )}
          <div style={{ fontSize:10, color:"#334155" }}>Analyzed {timeAgo(detection.fetchedAt)}</div>
        </div>
      )}

      {!crossing.hasCamera && prop && prop.mode === "clearing" && (
        <div style={{ marginBottom:12 }}>
          <div style={{ background:"#1a1530", border:"1px solid #7c3aed44", borderRadius:8, padding:"12px 14px", marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#c4b5fd", marginBottom:4 }}>Train passing through</div>
            <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6 }}>
              An eastbound train (heading toward Metairie Rd / New Orleans) already passed this
              crossing. It's clearing now — though a long train's tail may still be occupying it.
              The camera can't see this crossing directly, so there's no exact countdown.
            </div>
          </div>
          <div style={{ fontSize:10, color:"#334155" }}>Detected {timeAgo(prop.propagatedAt)}</div>
        </div>
      )}

      {!crossing.hasCamera && prop && prop.mode === "approaching" && (
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
            <Stat label="ETA"           value={etaLabel(prop.eta_mins)}      color="#f97316" large />
            <Stat label="Direction"     value="westbound"                    color="#60a5fa" />
            <Stat label="Speed"         value={`${prop.speed_mph} mph`}      color="#f59e0b" />
            <Stat label="From Camera"   value={prop.sourceName}              color="#a78bfa" />
            <Stat label="Distance"      value={`${prop.distMiles.toFixed(2)} mi`} color="#94a3b8" />
            <Stat label="Confidence"    value={`${Math.round(prop.confidence * 100)}%`} color={confidenceBadge(prop.confidence).color} />
          </div>
          <div style={{ fontSize:10, color:"#334155" }}>Train heading west toward this crossing · detected {timeAgo(prop.propagatedAt)}</div>
        </div>
      )}

      {!detection && !prop && (
        <div style={{ color:"#334155", fontSize:12, padding:"4px 0 10px", lineHeight:1.6 }}>
          No data yet. {crossing.hasCamera ? "Press Scan Now to analyze." : "Predictions appear when a train is detected at Metairie Rd."}
        </div>
      )}

      {/* Report button */}
      <button onClick={() => onReport(crossing)} style={{
        width:"100%", background:"#1e2d45", border:"1px solid #334155",
        borderRadius:7, color:"#94a3b8", cursor:"pointer", padding:"8px",
        fontSize:12, fontWeight:600, marginBottom:12,
      }}>📝 Submit Community Report</button>

      {/* Email alert subscription */}
      <div style={{ background:"#0a1018", borderRadius:8, padding:"10px 12px" }}>
        <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.5px", marginBottom:8 }}>🔔 EMAIL ALERTS FOR THIS CROSSING</div>
        {alertSaved ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:12, color:"#86efac" }}>✓ Alerts → {alerts[crossing.id]}</div>
            <button onClick={clearAlert} style={{ background:"#450a0a", border:"1px solid #ef444444", borderRadius:5, color:"#fca5a5", padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Remove</button>
          </div>
        ) : (
          <div style={{ display:"flex", gap:6 }}>
            <input
              type="email" placeholder="your@email.com" value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveAlert()}
              style={{ flex:1, background:"#0d1420", border:"1px solid #1e2d45", borderRadius:6, color:"#e2e8f0", padding:"6px 10px", fontSize:12, outline:"none" }}
            />
            <button onClick={saveAlert} style={{ background:"#1d4ed8", border:"none", borderRadius:6, color:"#fff", padding:"6px 12px", fontSize:12, fontWeight:700, cursor:"pointer" }}>Save</button>
          </div>
        )}
        <div style={{ fontSize:10, color:"#334155", marginTop:6 }}>Alerts fire on train detection + all-clear. 30-min cooldown.</div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, large }) {
  return (
    <div style={{ background:"#0a1018", borderRadius:6, padding:"8px 10px" }}>
      <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.5px", marginBottom:2 }}>{label}</div>
      <div style={{ fontSize: large ? 18 : 14, fontWeight:800, color, lineHeight:1.2 }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Crossing card — featured (live camera) crossing
// ─────────────────────────────────────────────────────────────────────────────
function StatusDot({ color, pulse, size = 12 }) {
  return (
    <span style={{
      width:size, height:size, borderRadius:"50%", flexShrink:0, display:"inline-block",
      background:color, boxShadow:`0 0 8px ${color}`,
      animation: pulse ? "pulse-dot 1.2s infinite" : "none",
    }} />
  );
}

function CrossingCard({ crossing, detection, prop, isSelected, onClick, onReport, featured }) {
  const st = crossingStatus(
    crossing,
    detection ? { [crossing.id]: detection } : {},
    prop ? { [crossing.id]: prop } : {}
  );
  return (
    <div style={{
      background: st.bg, border:`1px solid ${isSelected ? st.color : st.border}`,
      borderRadius:12, padding:"14px 16px", cursor:"pointer",
      transition:"border-color 0.15s", display:"flex", alignItems:"center", gap:13,
      boxShadow: st.urgent ? `0 0 16px ${st.border}44` : "none",
    }}>
      <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:13, flex:1, minWidth:0 }}>
        <StatusDot color={st.color} pulse={st.urgent} size={14} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontWeight:700, color:"#f1f5f9", fontSize:16 }}>{crossing.name}</span>
            <span style={{ fontSize:9, color:"#3a4a63", letterSpacing:"0.3px" }}>LIVE CAMERA</span>
          </div>
          {detection?.notes && (
            <div style={{ fontSize:12, color:"#64748b", marginTop:3, fontStyle:"italic", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{detection.notes}</div>
          )}
          {!detection && (
            <div style={{ fontSize:12, color:"#475569", marginTop:3 }}>Waiting for first scan…</div>
          )}
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color:st.color, letterSpacing:"0.2px" }}>{st.label}</div>
          {detection?.confidence != null && <div style={{ fontSize:9, color:"#3a4a63", marginTop:2 }}>{Math.round(detection.confidence * 100)}% confident</div>}
        </div>
      </div>
      <button onClick={e => { e.stopPropagation(); onReport(); }} style={{
        background:"#0a1018", border:"1px solid #1e2d45", borderRadius:7,
        color:"#475569", cursor:"pointer", padding:"7px 9px", fontSize:13, flexShrink:0,
      }} title="Report">📝</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Crossing row — compact, for downstream (no-camera) crossings
// ─────────────────────────────────────────────────────────────────────────────
function CrossingRow({ crossing, prop, isSelected, onClick }) {
  const st = crossingStatus(crossing, {}, prop ? { [crossing.id]: prop } : {});
  // When there's no prediction, present it calm/neutral rather than alarming
  const idle = !prop;
  const dotColor = idle ? "#2d3a4f" : st.color;
  const label = idle ? "Clear" : st.label;
  const labelColor = idle ? "#475569" : st.color;

  return (
    <div onClick={onClick} style={{
      background: idle ? "#0b111c" : st.bg,
      border:`1px solid ${isSelected ? st.color : (idle ? "#161f30" : st.border)}`,
      borderRadius:10, padding:"10px 14px", cursor:"pointer",
      display:"flex", alignItems:"center", gap:12,
      transition:"border-color 0.15s",
    }}>
      <StatusDot color={dotColor} pulse={!idle && st.urgent} size={10} />
      <div style={{ flex:1, minWidth:0 }}>
        <span style={{ fontWeight:600, color: idle ? "#cbd5e1" : "#f1f5f9", fontSize:14 }}>{crossing.name}</span>
        {prop && prop.mode === "approaching" && (
          <span style={{ fontSize:11, color:"#60a5fa", marginLeft:8 }}>train approaching</span>
        )}
        {prop && prop.mode === "clearing" && (
          <span style={{ fontSize:11, color:"#a78bfa", marginLeft:8 }}>train passing through</span>
        )}
      </div>
      <div style={{ fontSize:13, fontWeight:700, color:labelColor, flexShrink:0 }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls bar
// ─────────────────────────────────────────────────────────────────────────────
function Controls({ analyzing, isPolling, intervalSecs, onScan, onTogglePolling, onSetInterval }) {
  return (
    <div style={{ padding:"12px 14px", background:"#0d1420", border:"1px solid #1e2d45", borderRadius:10, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <button onClick={onScan} disabled={analyzing} style={{
        background: analyzing ? "#1a2535" : "#1d4ed8", border:"none", borderRadius:7,
        color: analyzing ? "#475569" : "#fff", padding:"8px 16px", fontWeight:700, fontSize:12,
        cursor: analyzing ? "not-allowed" : "pointer", letterSpacing:"0.3px",
      }}>
        {analyzing ? "⏳ Scanning…" : "🔍 Scan Now"}
      </button>
      <button onClick={onTogglePolling} style={{
        background: isPolling ? "#450a0a" : "#052e16",
        border:`1px solid ${isPolling ? "#ef444466" : "#16a34a66"}`,
        borderRadius:7, color: isPolling ? "#fca5a5" : "#86efac",
        padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer",
      }}>
        {isPolling ? "⏹ Stop" : "▶ Auto-Scan"}
      </button>
      <div style={{ display:"flex", alignItems:"center", gap:5, marginLeft:"auto" }}>
        <span style={{ fontSize:10, color:"#475569" }}>every</span>
        {[10, 15, 30, 60].map(s => (
          <button key={s} onClick={() => onSetInterval(s)} style={{
            background: intervalSecs === s ? "#1e3a5f" : "none",
            border:`1px solid ${intervalSecs === s ? "#3b82f6" : "#1e2d45"}`,
            borderRadius:5, color: intervalSecs === s ? "#60a5fa" : "#475569",
            padding:"4px 7px", fontSize:10, cursor:"pointer",
            fontWeight: intervalSecs === s ? 700 : 400,
          }}>{s}s</button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Community report modal
// ─────────────────────────────────────────────────────────────────────────────
function ReportModal({ crossing, onSubmit, onClose }) {
  const [trainPresent, setTrainPresent] = useState(true);
  const [direction, setDirection] = useState("westbound");
  const [speed, setSpeed] = useState("");
  const [length, setLength] = useState("medium");
  const [note, setNote] = useState("");

  function submit() {
    onSubmit({
      crossingId: crossing.id,
      crossingName: crossing.name,
      train_present: trainPresent,
      direction: trainPresent ? direction : "none",
      speed_mph: speed ? parseInt(speed) : null,
      length,
      note: note.trim(),
    });
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#0d1420", border:"1px solid #1e2d45", borderRadius:"12px 12px 0 0", padding:20, width:"100%", maxWidth:480, animation:"slide-in 0.2s ease" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:"#f1f5f9" }}>Report Train</div>
            <div style={{ fontSize:11, color:"#475569" }}>{crossing.name}</div>
          </div>
          <button onClick={onClose} style={{ background:"#1e2d45", border:"none", borderRadius:5, color:"#94a3b8", cursor:"pointer", width:28, height:28, fontSize:16 }}>×</button>
        </div>

        {/* Train present toggle */}
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          {[true, false].map(v => (
            <button key={String(v)} onClick={() => setTrainPresent(v)} style={{
              flex:1, padding:"10px", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer",
              background: trainPresent === v ? (v ? "#450a0a" : "#052e16") : "#0a1018",
              border:`1.5px solid ${trainPresent === v ? (v ? "#ef4444" : "#22c55e") : "#1e2d45"}`,
              color: trainPresent === v ? (v ? "#fca5a5" : "#86efac") : "#475569",
            }}>{v ? "🚂 Train Here" : "✓ All Clear"}</button>
          ))}
        </div>

        {trainPresent && (
          <>
            {/* Direction */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#475569", marginBottom:6, letterSpacing:"0.5px" }}>DIRECTION</div>
              <div style={{ display:"flex", gap:6 }}>
                {["westbound","eastbound","stopped"].map(d => (
                  <button key={d} onClick={() => setDirection(d)} style={{
                    flex:1, padding:"7px 4px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                    background: direction === d ? "#1e3a5f" : "#0a1018",
                    border:`1px solid ${direction === d ? "#3b82f6" : "#1e2d45"}`,
                    color: direction === d ? "#60a5fa" : "#475569",
                  }}>{d === "westbound" ? "← West" : d === "eastbound" ? "East →" : "⏹ Stopped"}</button>
                ))}
              </div>
            </div>

            {/* Speed */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#475569", marginBottom:6, letterSpacing:"0.5px" }}>ESTIMATED SPEED (MPH, optional)</div>
              <input type="number" placeholder="e.g. 10" value={speed} onChange={e => setSpeed(e.target.value)}
                style={{ width:"100%", background:"#0a1018", border:"1px solid #1e2d45", borderRadius:6, color:"#e2e8f0", padding:"8px 10px", fontSize:13, outline:"none" }} />
            </div>

            {/* Train length */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#475569", marginBottom:6, letterSpacing:"0.5px" }}>TRAIN LENGTH</div>
              <div style={{ display:"flex", gap:6 }}>
                {["short","medium","long"].map(l => (
                  <button key={l} onClick={() => setLength(l)} style={{
                    flex:1, padding:"7px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                    background: length === l ? "#1e2d45" : "#0a1018",
                    border:`1px solid ${length === l ? "#475569" : "#1e2d45"}`,
                    color: length === l ? "#f1f5f9" : "#475569",
                  }}>{l.charAt(0).toUpperCase() + l.slice(1)}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Note */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:"#475569", marginBottom:6, letterSpacing:"0.5px" }}>NOTE (optional)</div>
          <input placeholder="Any extra details..." value={note} onChange={e => setNote(e.target.value)}
            style={{ width:"100%", background:"#0a1018", border:"1px solid #1e2d45", borderRadius:6, color:"#e2e8f0", padding:"8px 10px", fontSize:13, outline:"none" }} />
        </div>

        <button onClick={submit} style={{ width:"100%", background:"#1d4ed8", border:"none", borderRadius:8, color:"#fff", padding:"12px", fontWeight:800, fontSize:14, cursor:"pointer" }}>
          Submit Report
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap tab — 24h × day-of-week grid
// ─────────────────────────────────────────────────────────────────────────────
const DAYS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function HeatmapTab({ history }) {
  const [selectedCrossing, setSelectedCrossing] = useState("all");

  // Build grid: day[0..6] × hour[0..23] → { total, trains }
  const grid = useMemo(() => {
    const g = {};
    DAYS.forEach((_, d) => {
      g[d] = {};
      HOURS.forEach(h => { g[d][h] = { total: 0, trains: 0 }; });
    });

    const filtered = selectedCrossing === "all"
      ? history
      : history.filter(r => r.crossingId === selectedCrossing);

    filtered.forEach(r => {
      const d = new Date(r.ts);
      const day  = d.getDay();
      const hour = d.getHours();
      g[day][hour].total++;
      if (r.train_present) g[day][hour].trains++;
    });

    return g;
  }, [history, selectedCrossing]);

  // Find max probability for color scaling
  const maxProb = useMemo(() => {
    let m = 0;
    DAYS.forEach((_, d) => HOURS.forEach(h => {
      const cell = grid[d][h];
      if (cell.total > 0) m = Math.max(m, cell.trains / cell.total);
    }));
    return m || 1;
  }, [grid]);

  function cellColor(cell) {
    if (cell.total === 0) return "#0d1420";
    const prob = cell.trains / cell.total;
    const intensity = prob / maxProb;
    if (prob === 0) return "#052e16";
    const r = Math.round(239 * intensity);
    const g = Math.round(68 + (180 - 68) * (1 - intensity));
    const b = Math.round(68 * (1 - intensity) + 20);
    return `rgb(${r},${g},${b})`;
  }

  const totalScans  = history.length;
  const trainScans  = history.filter(r => r.train_present).length;
  const trainRate   = totalScans > 0 ? ((trainScans / totalScans) * 100).toFixed(1) : "—";

  // "Right now" verdict — probability for the current hour, this day of week,
  // widened to a ±1 hour window so it's meaningful with limited data.
  const nowVerdict = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const hours = [(hour + 23) % 24, hour, (hour + 1) % 24];
    let trains = 0, total = 0;
    hours.forEach(h => { trains += grid[day][h].trains; total += grid[day][h].total; });
    // Also compute same-hour across all days as a fallback
    let allTrains = 0, allTotal = 0;
    DAYS.forEach((_, d) => hours.forEach(h => { allTrains += grid[d][h].trains; allTotal += grid[d][h].total; }));
    return {
      hour,
      dayTotal: total, dayProb: total > 0 ? trains / total : null,
      allTotal, allProb: allTotal > 0 ? allTrains / allTotal : null,
    };
  }, [grid]);

  function verdictColor(p) {
    if (p == null) return { bg:"#0c1a2e", border:"#3b82f644", color:"#93c5fd" };
    if (p >= 0.4)  return { bg:"#450a0a", border:"#ef4444", color:"#fca5a5" };
    if (p >= 0.15) return { bg:"#2d1200", border:"#f97316", color:"#fdba74" };
    return            { bg:"#052e16", border:"#22c55e", color:"#86efac" };
  }

  // Peak hour
  const hourTotals = HOURS.map(h => {
    let trains = 0, total = 0;
    DAYS.forEach((_, d) => { trains += grid[d][h].trains; total += grid[d][h].total; });
    return { h, prob: total > 0 ? trains / total : 0, total };
  });
  const peakHour = hourTotals.reduce((a, b) => (b.prob > a.prob && b.total >= 3 ? b : a), { h: null, prob: 0 });

  return (
    <div style={{ padding:14 }}>
      {/* "Right now" verdict — the core use case */}
      {(() => {
        const p = nowVerdict.dayProb ?? nowVerdict.allProb;
        const usingFallback = nowVerdict.dayProb == null && nowVerdict.allProb != null;
        const n = nowVerdict.dayProb != null ? nowVerdict.dayTotal : nowVerdict.allTotal;
        const vc = verdictColor(p);
        const hourLabel = `${nowVerdict.hour}:00–${(nowVerdict.hour + 1) % 24}:00`;
        return (
          <div style={{ background:vc.bg, border:`1.5px solid ${vc.border}`, borderRadius:12, padding:"16px 18px", marginBottom:14 }}>
            <div style={{ fontSize:10, color:vc.color, opacity:0.7, letterSpacing:"0.5px", marginBottom:6 }}>
              RIGHT NOW · {hourLabel} {usingFallback ? "(all days)" : "(this weekday)"}
            </div>
            {p == null ? (
              <div style={{ fontSize:15, fontWeight:700, color:vc.color }}>
                Not enough data yet for this time
              </div>
            ) : (
              <>
                <div style={{ fontSize:26, fontWeight:800, color:vc.color, lineHeight:1.1 }}>
                  {Math.round(p * 100)}% chance of a train
                </div>
                <div style={{ fontSize:12, color:vc.color, opacity:0.85, marginTop:6 }}>
                  {p >= 0.4 ? "⚠ High — consider an alternate route"
                   : p >= 0.15 ? "Moderate — check the live status above before leaving"
                   : "✓ Low — usually clear at this time"}
                </div>
                <div style={{ fontSize:10, color:vc.color, opacity:0.55, marginTop:8 }}>
                  Based on {n} past check{n !== 1 ? "s" : ""} around this hour
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Summary stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14 }}>
        <SummaryCard label="Total Scans" value={totalScans} color="#60a5fa" />
        <SummaryCard label="Train Sightings" value={trainScans} color="#f97316" />
        <SummaryCard label="Train Rate" value={`${trainRate}%`} color="#f59e0b" />
      </div>

      {peakHour.h !== null && peakHour.prob > 0 && (
        <div style={{ background:"#1c1400", border:"1px solid #f59e0b44", borderRadius:8, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#fbbf24" }}>
          🔥 Peak hour: <strong>{peakHour.h}:00–{peakHour.h+1}:00</strong> ({Math.round(peakHour.prob * 100)}% train probability)
        </div>
      )}

      {totalScans < 10 && (
        <div style={{ background:"#0c1a2e", border:"1px solid #3b82f644", borderRadius:8, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#93c5fd" }}>
          ℹ Run more scans to build a meaningful heatmap. Showing {totalScans} data point{totalScans !== 1 ? "s" : ""}.
        </div>
      )}

      {/* Crossing selector */}
      <div style={{ display:"flex", gap:6, marginBottom:14, overflowX:"auto", paddingBottom:4 }}>
        {[{ id:"all", name:"All Crossings" }, ...CROSSINGS].map(c => (
          <button key={c.id} onClick={() => setSelectedCrossing(c.id)} style={{
            padding:"5px 10px", borderRadius:6, fontSize:10, fontWeight:700,
            cursor:"pointer", flexShrink:0,
            background: selectedCrossing === c.id ? "#1e3a5f" : "#0a1018",
            border:`1px solid ${selectedCrossing === c.id ? "#3b82f6" : "#1e2d45"}`,
            color: selectedCrossing === c.id ? "#60a5fa" : "#475569",
          }}>{c.short || c.name}</button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ background:"#0d1420", border:"1px solid #1e2d45", borderRadius:10, padding:12, overflowX:"auto" }}>
        <div style={{ fontSize:11, color:"#93c5fd", marginBottom:10, letterSpacing:"0.8px", fontWeight:700 }}>TRAIN PROBABILITY BY HOUR & DAY OF WEEK</div>

        <div style={{ display:"grid", gridTemplateColumns:`28px repeat(24, 1fr)`, gap:2, minWidth:600 }}>
          {/* Hour headers */}
          <div />
          {HOURS.map(h => (
            <div key={h} style={{ fontSize:9, color:"#94a3b8", textAlign:"center", paddingBottom:4, fontWeight:600 }}>
              {h % 3 === 0 ? `${h}h` : ""}
            </div>
          ))}

          {/* Rows */}
          {DAYS.map((day, d) => (
            <>
              <div key={`label-${d}`} style={{ fontSize:10, color:"#cbd5e1", display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:6, fontWeight:600 }}>{day}</div>
              {HOURS.map(h => {
                const cell = grid[d][h];
                const prob = cell.total > 0 ? Math.round((cell.trains / cell.total) * 100) : null;
                return (
                  <div key={`${d}-${h}`} title={cell.total > 0 ? `${day} ${h}:00 — ${cell.trains}/${cell.total} (${prob}%)` : `${day} ${h}:00 — no data`}
                    style={{
                      height:18, borderRadius:2,
                      background: cellColor(cell),
                      border: "1px solid #0d1420",
                      cursor: cell.total > 0 ? "pointer" : "default",
                    }}
                  />
                );
              })}
            </>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
          <span style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>Low</span>
          <div style={{ display:"flex", gap:2 }}>
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => (
              <div key={v} style={{ width:16, height:10, borderRadius:2, background: cellColor({ trains: v, total: 1 }) }} />
            ))}
          </div>
          <span style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>High</span>
          <span style={{ fontSize:9, color:"#64748b", marginLeft:"auto" }}>Gray = no data</span>
        </div>
      </div>

      {/* Hour breakdown bar chart */}
      {totalScans >= 5 && (
        <div style={{ background:"#0d1420", border:"1px solid #1e2d45", borderRadius:10, padding:12, marginTop:12 }}>
          <div style={{ fontSize:11, color:"#93c5fd", marginBottom:10, letterSpacing:"0.8px", fontWeight:700 }}>TRAIN PROBABILITY BY HOUR (ALL DAYS)</div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:60 }}>
            {hourTotals.map(({ h, prob, total }) => (
              <div key={h} title={`${h}:00 — ${Math.round(prob * 100)}% (${total} scans)`}
                style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <div style={{
                  width:"100%", borderRadius:"2px 2px 0 0",
                  background: prob > 0 ? `rgba(239,68,68,${0.2 + prob * 0.8})` : "#0a1018",
                  height: `${Math.max(2, prob * 100)}%`,
                  minHeight: total > 0 ? 2 : 0,
                  transition:"height 0.3s",
                }} />
              </div>
            ))}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
            {[0,6,12,18,23].map(h => (
              <span key={h} style={{ fontSize:9, color:"#94a3b8", fontWeight:600 }}>{h}h</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background:"#0d1420", border:"1px solid #1e2d45", borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
      <div style={{ fontSize:9, color:"#94a3b8", marginBottom:4, letterSpacing:"0.5px", fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Log tab
// ─────────────────────────────────────────────────────────────────────────────
function LogTab({ scanLog, reports }) {
  const [view, setView] = useState("all"); // all | scans | reports
  const combined = [
    ...scanLog.map(r => ({ ...r, _type:"scan" })),
    ...reports.map(r => ({ ...r, _type:"report" })),
  ].sort((a, b) => b.ts - a.ts);

  const filtered = view === "scans" ? combined.filter(r => r._type === "scan")
                 : view === "reports" ? combined.filter(r => r._type === "report")
                 : combined;

  return (
    <div style={{ padding:14 }}>
      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        {["all","scans","reports"].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding:"5px 12px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer",
            background: view === v ? "#1e3a5f" : "#0a1018",
            border:`1px solid ${view === v ? "#3b82f6" : "#1e2d45"}`,
            color: view === v ? "#60a5fa" : "#475569",
          }}>{v.charAt(0).toUpperCase() + v.slice(1)} {v === "all" ? `(${combined.length})` : v === "scans" ? `(${scanLog.length})` : `(${reports.length})`}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 20px", color:"#334155", fontSize:13 }}>No entries yet.</div>
      ) : (
        <div style={{ display:"grid", gap:7 }}>
          {filtered.slice(0, 100).map(entry => (
            <div key={entry.id} style={{
              background:"#0d1420",
              border:`1px solid ${entry.train_present ? "#ef444433" : "#1e2d45"}`,
              borderRadius:8, padding:"9px 12px",
              display:"flex", alignItems:"flex-start", gap:10,
              animation:"slide-in 0.15s ease",
            }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, paddingTop:2, flexShrink:0 }}>
                <div style={{
                  width:7, height:7, borderRadius:"50%",
                  background: entry.train_present ? "#ef4444" : "#22c55e",
                  boxShadow: entry.train_present ? "0 0 6px #ef4444" : "none",
                }} />
                <div style={{ fontSize:8, color:"#334155" }}>{entry._type === "report" ? "👤" : "🤖"}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight:700, fontSize:12, color:"#f1f5f9" }}>{entry.crossingName}</span>
                  <span style={{ fontSize:9, color:"#334155", fontFamily:"monospace" }}>
                    {new Date(entry.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
                  </span>
                </div>
                <div style={{ fontSize:11, marginTop:2, color: entry.train_present ? "#fca5a5" : "#86efac" }}>
                  {entry.train_present ? "🚂 TRAIN" : "✓ Clear"}
                  {entry.direction && entry.direction !== "none" && ` · ${entry.direction}`}
                  {entry.speed_estimate_mph && ` · ${entry.speed_estimate_mph} mph`}
                  {entry.speed_mph && ` · ${entry.speed_mph} mph`}
                  {entry.confidence != null && ` · ${Math.round(entry.confidence * 100)}% conf`}
                  {entry.length && ` · ${entry.length}`}
                </div>
                {(entry.notes || entry.note) && (
                  <div style={{ fontSize:10, color:"#4b5563", marginTop:2, fontStyle:"italic" }}>{entry.notes || entry.note}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// About tab
// ─────────────────────────────────────────────────────────────────────────────
function AboutTab() {
  return (
    <div style={{ padding:14, display:"grid", gap:10 }}>
      <InfoCard title="Vision Detection">
        <ol style={{ paddingLeft:16, marginTop:6, lineHeight:1.9, fontSize:12, color:"#94a3b8" }}>
          <li>Serverless function resolves live snapshot URL from JP ipcamlive feed</li>
          <li>Snapshot fetched server-side (no CORS issues)</li>
          <li>Claude Sonnet Vision analyzes image → train present, direction, speed, gates, confidence</li>
          <li>Physics engine propagates ETAs to the 4 crossings without cameras</li>
          <li>After {CLEAR_CONFIRM_SCANS} consecutive clear scans → "ALL CLEAR" event fires</li>
        </ol>
      </InfoCard>
      <InfoCard title="Community Reports">
        <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6 }}>
          Tap 📝 on any crossing card or inside the detail panel to submit a report.
          Reports feed into the physics propagation engine alongside AI detections
          and are included in the heatmap history. Stored locally in your browser.
        </div>
      </InfoCard>
      <InfoCard title="Email Alerts">
        <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6 }}>
          Tap any crossing → expand detail panel → enter email to subscribe.
          Alerts fire on train detection and all-clear confirmation (30-min cooldown).
          Powered by Resend. Requires <span style={{ fontFamily:"monospace", color:"#60a5fa" }}>RESEND_API_KEY</span> in Netlify env vars.
        </div>
      </InfoCard>
      <InfoCard title="Crossings">
        {CROSSINGS.map(c => (
          <div key={c.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #111827", fontSize:12 }}>
            <div>
              <span style={{ color:"#f1f5f9", fontWeight:600 }}>{c.name}</span>
              <span style={{ color:"#475569", fontSize:10, marginLeft:6 }}>DOT #{c.dot}</span>
            </div>
            <div style={{ textAlign:"right" }}>
              {c.hasCamera
                ? <span style={{ fontFamily:"monospace", fontSize:10, color:"#60a5fa" }}>{c.alias}</span>
                : <span style={{ fontSize:10, color:"#1e2d45" }}>{Math.abs(c.distFromMetairie).toFixed(2)} mi west</span>
              }
            </div>
          </div>
        ))}
      </InfoCard>
    </div>
  );
}

function InfoCard({ title, children }) {
  return (
    <div style={{ background:"#0d1420", border:"1px solid #1e2d45", borderRadius:10, padding:14 }}>
      <div style={{ fontWeight:700, fontSize:13, color:"#f1f5f9", marginBottom:10 }}>{title}</div>
      {children}
    </div>
  );
}


