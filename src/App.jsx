import { useState, useEffect, useRef, useCallback } from "react";
import { CROSSINGS } from "./crossings.js";
import { getSnapshotUrl, getSnapshotImage, analyzeVision } from "./api.js";
import { propagate } from "./physics.js";
import { timeAgo, etaLabel, confidenceBadge, crossingStatus } from "./utils.js";

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [detections,  setDetections]  = useState({});  // id → detection obj
  const [propagated,  setPropagated]  = useState({});  // id → propagation obj
  const [snapshots,   setSnapshots]   = useState({});  // id → { url, fetchedAt }
  const [log,         setLog]         = useState([]);  // detection history
  const [tab,         setTab]         = useState("corridor");
  const [selected,    setSelected]    = useState(null);
  const [isPolling,   setIsPolling]   = useState(false);
  const [interval,    setIntervalVal] = useState(15);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [errors,      setErrors]      = useState([]);  // array of error strings
  const [lastScan,    setLastScan]    = useState(null);
  const pollerRef = useRef(null);

  // ── Core scan cycle ────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setErrors([]);

    const errs = [];
    const cameraCrossings = CROSSINGS.filter(c => c.hasCamera && c.alias);

    for (const crossing of cameraCrossings) {
      try {
        // 1. Resolve live snapshot URL via Netlify function
        const { online, snapshotUrl } = await getSnapshotUrl(crossing.alias);

        if (!online || !snapshotUrl) {
          errs.push(`${crossing.name}: camera offline`);
          continue;
        }

        setSnapshots(prev => ({
          ...prev,
          [crossing.id]: { url: snapshotUrl, fetchedAt: Date.now() },
        }));

        // 2. Fetch snapshot image as base64 via Netlify function
        const { base64, mediaType } = await getSnapshotImage(snapshotUrl);

        // 3. Analyze with Claude Vision via Netlify function
        const detection = await analyzeVision({
          base64,
          mediaType,
          crossingId: crossing.id,
          crossingName: crossing.name,
        });

        const detWithTs = { ...detection, fetchedAt: Date.now() };
        setDetections(prev => ({ ...prev, [crossing.id]: detWithTs }));

        // 4. Physics-propagate to crossings without cameras
        if (detection.train_present) {
          const props = propagate(detection, crossing);
          setPropagated(props);
        } else {
          // Clear propagation if no train detected
          setPropagated(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(k => {
              if (next[k]?.sourceId === crossing.id) delete next[k];
            });
            return next;
          });
        }

        // 5. Append to log
        setLog(prev => [{
          id: `${crossing.id}-${Date.now()}`,
          crossingId: crossing.id,
          crossingName: crossing.short,
          ...detWithTs,
          loggedAt: Date.now(),
        }, ...prev.slice(0, 99)]);

      } catch (e) {
        errs.push(`${crossing.name}: ${e.message}`);
      }
    }

    if (errs.length) setErrors(errs);
    setLastScan(Date.now());
    setAnalyzing(false);
  }, [analyzing]);

  // ── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPolling) {
      runScan();
      pollerRef.current = setInterval(runScan, interval * 1000);
    } else {
      clearInterval(pollerRef.current);
    }
    return () => clearInterval(pollerRef.current);
  }, [isPolling, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ───────────────────────────────────────────────────────────
  const anyUrgent = CROSSINGS.some(c => {
    const st = crossingStatus(c, detections, propagated);
    return st.urgent;
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#080b10", display: "flex", flexDirection: "column" }}>
      <Header
        anyUrgent={anyUrgent}
        analyzing={analyzing}
        lastScan={lastScan}
        isPolling={isPolling}
        interval={interval}
      />

      <TabBar tab={tab} setTab={setTab} />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "corridor" && (
          <CorridorTab
            detections={detections}
            propagated={propagated}
            snapshots={snapshots}
            analyzing={analyzing}
            isPolling={isPolling}
            interval={interval}
            errors={errors}
            selected={selected}
            setSelected={setSelected}
            onScan={runScan}
            onTogglePolling={() => setIsPolling(p => !p)}
            onSetInterval={setIntervalVal}
          />
        )}
        {tab === "log" && <LogTab log={log} />}
        {tab === "about" && <AboutTab />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header({ anyUrgent, analyzing, lastScan, isPolling, interval }) {
  return (
    <div style={{
      background: "linear-gradient(180deg,#0f172a 0%,#080b10 100%)",
      borderBottom: "1px solid #1e2d45",
      padding: "14px 16px 10px",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
        <div style={{
          width:34, height:34, borderRadius:8, flexShrink:0,
          background: anyUrgent ? "#ef4444" : "#1e3a5f",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:18,
          boxShadow: anyUrgent ? "0 0 18px #ef444480" : "none",
          transition:"all 0.4s",
          animation: anyUrgent ? "glow-red 2s infinite" : "none",
        }}>🚂</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:17, fontWeight:800, letterSpacing:"-0.3px", color:"#f1f5f9", lineHeight:1.2 }}>
            Metairie Rail Tracker
          </div>
          <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.6px", marginTop:1 }}>
            NORFOLK SOUTHERN · OLD METAIRIE CORRIDOR · AI VISION
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
          {analyzing && (
            <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#60a5fa" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#3b82f6", animation:"pulse-dot 1s infinite" }} />
              SCANNING
            </div>
          )}
          {isPolling && !analyzing && (
            <div style={{ fontSize:10, color:"#22c55e" }}>▶ AUTO {interval}s</div>
          )}
          {lastScan && !analyzing && (
            <div style={{ fontSize:10, color:"#334155" }}>{timeAgo(lastScan)}</div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        padding:"7px 10px",
        borderRadius:6,
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
          animation: anyUrgent ? "pulse-dot 1.2s infinite" : "none",
          flexShrink:0,
        }} />
        {anyUrgent ? "⚠  TRAIN ACTIVITY ON CORRIDOR" : "✓  ALL CROSSINGS CLEAR"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────────────────
function TabBar({ tab, setTab }) {
  const tabs = [
    { id:"corridor", label:"🗺  Corridor" },
    { id:"log",      label:"📋  Log" },
    { id:"about",    label:"ℹ  About" },
  ];
  return (
    <div style={{ display:"flex", borderBottom:"1px solid #1e2d45", background:"#0a0e16" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex:1, background:"none", border:"none", cursor:"pointer",
          padding:"10px 4px", fontSize:11, fontWeight:700,
          letterSpacing:"0.4px",
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
function CorridorTab({
  detections, propagated, snapshots,
  analyzing, isPolling, interval, errors,
  selected, setSelected,
  onScan, onTogglePolling, onSetInterval,
}) {
  return (
    <div style={{ padding:14 }}>
      {/* Corridor strip */}
      <CorridorStrip detections={detections} propagated={propagated} selected={selected} setSelected={setSelected} />

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          crossing={selected}
          detection={detections[selected.id]}
          prop={propagated[selected.id]}
          snapshot={snapshots[selected.id]}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Crossing cards */}
      <div style={{ display:"grid", gap:8, marginBottom:12 }}>
        {[...CROSSINGS].reverse().map(c => (
          <CrossingCard
            key={c.id}
            crossing={c}
            detection={detections[c.id]}
            prop={propagated[c.id]}
            isSelected={selected?.id === c.id}
            onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
          />
        ))}
      </div>

      {/* Controls */}
      <Controls
        analyzing={analyzing}
        isPolling={isPolling}
        interval={interval}
        onScan={onScan}
        onTogglePolling={onTogglePolling}
        onSetInterval={onSetInterval}
      />

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{
          marginTop:10, padding:"10px 12px",
          background:"#2d0a0a", border:"1px solid #ef444433",
          borderRadius:8, animation:"slide-in 0.2s ease",
        }}>
          {errors.map((e,i) => (
            <div key={i} style={{ fontSize:11, color:"#fca5a5", marginBottom: i < errors.length-1 ? 4 : 0 }}>
              ⚠ {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Corridor strip
// ─────────────────────────────────────────────────────────────────────────────
function CorridorStrip({ detections, propagated, selected, setSelected }) {
  return (
    <div style={{
      background:"#0d1420", border:"1px solid #1e2d45",
      borderRadius:10, padding:"14px 14px 10px",
      marginBottom:12, overflowX:"auto",
    }}>
      <div style={{ fontSize:10, color:"#334155", marginBottom:10, letterSpacing:"0.5px" }}>
        WEST ←──── NORFOLK SOUTHERN OLD METAIRIE CORRIDOR ────→ EAST
      </div>
      <div style={{ display:"flex", alignItems:"stretch", minWidth:460, gap:2 }}>
        {CROSSINGS.map((c, i) => {
          const st = crossingStatus(c, detections, propagated);
          const isSelected = selected?.id === c.id;
          return (
            <div key={c.id} style={{ display:"flex", alignItems:"center", flex:1, gap:2 }}>
              <div
                onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
                style={{
                  flex:1, cursor:"pointer",
                  background: isSelected ? st.bg : st.bg,
                  border:`1.5px solid ${isSelected ? st.color : st.border}`,
                  borderRadius:7, padding:"9px 6px",
                  textAlign:"center",
                  transition:"all 0.15s",
                  boxShadow: st.urgent ? `0 0 12px ${st.border}55` : "none",
                }}
              >
                <div style={{ fontSize:9, color:"#4b5563", marginBottom:2 }}>
                  {c.hasCamera ? "📷" : "○"}
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:"#f1f5f9", marginBottom:3, lineHeight:1.2 }}>
                  {c.short}
                </div>
                <div style={{ fontSize:9, fontWeight:800, color:st.color, letterSpacing:"0.3px" }}>
                  {st.label}
                </div>
              </div>
              {i < CROSSINGS.length - 1 && (
                <div style={{ width:10, height:1.5, background:"#1e2d45", flexShrink:0 }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:"#1e2d45", marginTop:8 }}>
        📷 live camera  ○ physics prediction  · tap crossing for details
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────
function DetailPanel({ crossing, detection, prop, snapshot, onClose }) {
  const st = crossingStatus(crossing, detection ? { [crossing.id]: detection } : {}, prop ? { [crossing.id]: prop } : {});

  return (
    <div style={{
      background:"#0d1420", border:`1px solid ${st.border}55`,
      borderRadius:10, padding:14, marginBottom:12,
      animation:"slide-in 0.15s ease",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:15, color:"#f1f5f9" }}>{crossing.name}</div>
          <div style={{ fontSize:11, color:"#475569", marginTop:1 }}>
            DOT #{crossing.dot} · {crossing.hasCamera ? "📷 Live JP camera" : "○ Physics prediction only"}
          </div>
        </div>
        <button onClick={onClose} style={{
          background:"#1e2d45", border:"none", borderRadius:5,
          color:"#94a3b8", cursor:"pointer", width:26, height:26,
          fontSize:14, display:"flex", alignItems:"center", justifyContent:"center",
        }}>×</button>
      </div>

      {crossing.hasCamera && detection && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
            <Stat label="Train Present"   value={detection.train_present ? "YES" : "NO"} color={detection.train_present ? "#ef4444" : "#22c55e"} />
            <Stat label="Crossing Blocked" value={detection.crossing_blocked ? "BLOCKED" : "CLEAR"} color={detection.crossing_blocked ? "#ef4444" : "#22c55e"} />
            <Stat label="Direction"       value={detection.direction || "—"}              color="#60a5fa" />
            <Stat label="Speed"           value={detection.speed_estimate_mph ? `${detection.speed_estimate_mph} mph` : "—"} color="#f59e0b" />
            <Stat label="Gates Down"      value={detection.gates_down === null ? "—" : detection.gates_down ? "YES" : "NO"} color="#a78bfa" />
            <Stat label="Confidence"      value={detection.confidence ? `${Math.round(detection.confidence * 100)}%` : "—"} color={confidenceBadge(detection.confidence).color} />
          </div>
          {detection.notes && (
            <div style={{ background:"#0a1018", borderRadius:6, padding:"8px 10px", marginBottom:6 }}>
              <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.5px", marginBottom:3 }}>AI OBSERVATION</div>
              <div style={{ fontSize:12, color:"#94a3b8", fontStyle:"italic", lineHeight:1.5 }}>{detection.notes}</div>
            </div>
          )}
          <div style={{ fontSize:10, color:"#334155" }}>
            Analyzed {timeAgo(detection.fetchedAt)} · model: claude-sonnet-4-20250514
          </div>
        </div>
      )}

      {!crossing.hasCamera && prop && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
            <Stat label="ETA"             value={etaLabel(prop.eta_mins)}      color="#f97316" large />
            <Stat label="Direction"       value={prop.direction}               color="#60a5fa" />
            <Stat label="Detected Speed"  value={`${prop.speed_mph} mph`}      color="#f59e0b" />
            <Stat label="From Camera"     value={prop.sourceName}              color="#a78bfa" />
            <Stat label="Distance"        value={`${prop.distMiles.toFixed(2)} mi`} color="#94a3b8" />
            <Stat label="Confidence"      value={`${Math.round(prop.confidence * 100)}%`} color={confidenceBadge(prop.confidence).color} />
          </div>
          <div style={{ background:"#0a1018", borderRadius:6, padding:"8px 10px", marginBottom:6 }}>
            <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.5px", marginBottom:3 }}>HOW THIS IS CALCULATED</div>
            <div style={{ fontSize:11, color:"#64748b", lineHeight:1.6 }}>
              Claude Vision detected a <strong style={{ color:"#94a3b8" }}>{prop.direction}</strong> train
              at the <strong style={{ color:"#94a3b8" }}>{prop.sourceName}</strong> camera.
              At <strong style={{ color:"#94a3b8" }}>{prop.speed_mph} mph</strong> over{" "}
              <strong style={{ color:"#94a3b8" }}>{prop.distMiles.toFixed(2)} miles</strong> → ETA{" "}
              <strong style={{ color:"#f97316" }}>{etaLabel(prop.eta_mins)}</strong>.
              No physical camera at this crossing; prediction is physics-based only.
            </div>
          </div>
          <div style={{ fontSize:10, color:"#334155" }}>Propagated {timeAgo(prop.propagatedAt)}</div>
        </div>
      )}

      {!crossing.hasCamera && !prop && (
        <div style={{ color:"#334155", fontSize:12, padding:"6px 0", lineHeight:1.6 }}>
          No camera at this crossing. ETA predictions appear here when a train is detected
          at Metairie Rd moving westbound.
        </div>
      )}

      {crossing.hasCamera && !detection && (
        <div style={{ color:"#334155", fontSize:12, padding:"6px 0" }}>
          No scan yet. Press <strong style={{ color:"#60a5fa" }}>Scan Now</strong> to analyze this camera.
        </div>
      )}
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
// Crossing card
// ─────────────────────────────────────────────────────────────────────────────
function CrossingCard({ crossing, detection, prop, isSelected, onClick }) {
  const st = crossingStatus(
    crossing,
    detection ? { [crossing.id]: detection } : {},
    prop ? { [crossing.id]: prop } : {}
  );

  return (
    <div onClick={onClick} style={{
      background: st.bg,
      border:`1px solid ${isSelected ? st.color : st.border}`,
      borderRadius:10, padding:"11px 14px",
      cursor:"pointer", transition:"border-color 0.15s",
      display:"flex", alignItems:"center", gap:12,
      boxShadow: st.urgent ? `0 0 14px ${st.border}44` : "none",
    }}>
      <div style={{
        width:40, height:40, borderRadius:8, flexShrink:0,
        background:"#0a1018",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:20, border:`1px solid #1e2d45`,
      }}>
        {crossing.hasCamera ? "📷" : "🔮"}
      </div>

      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, color:"#f1f5f9", fontSize:14 }}>{crossing.name}</div>
        <div style={{ fontSize:10, color:"#475569", marginTop:1 }}>
          DOT #{crossing.dot} · {crossing.hasCamera ? "Vision-detected" : "Physics-propagated"}
        </div>
        {detection?.notes && (
          <div style={{ fontSize:11, color:"#64748b", marginTop:3, fontStyle:"italic",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {detection.notes}
          </div>
        )}
        {prop && !crossing.hasCamera && (
          <div style={{ fontSize:11, color:"#60a5fa", marginTop:3 }}>
            {prop.direction} · {prop.speed_mph} mph at {prop.sourceName}
          </div>
        )}
      </div>

      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:st.color, letterSpacing:"0.2px" }}>
          {st.label}
        </div>
        {detection?.confidence != null && (
          <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>
            {Math.round(detection.confidence * 100)}% conf
          </div>
        )}
        {prop && !crossing.hasCamera && (
          <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>
            {timeAgo(prop.propagatedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls bar
// ─────────────────────────────────────────────────────────────────────────────
function Controls({ analyzing, isPolling, interval, onScan, onTogglePolling, onSetInterval }) {
  return (
    <div style={{
      padding:"12px 14px", background:"#0d1420",
      border:"1px solid #1e2d45", borderRadius:10,
      display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
    }}>
      <button onClick={onScan} disabled={analyzing} style={{
        background: analyzing ? "#1a2535" : "#1d4ed8",
        border:"none", borderRadius:7, color: analyzing ? "#475569" : "#fff",
        padding:"8px 16px", fontWeight:700, fontSize:12,
        cursor: analyzing ? "not-allowed" : "pointer",
        letterSpacing:"0.3px", transition:"background 0.15s",
      }}>
        {analyzing ? "⏳ Scanning…" : "🔍 Scan Now"}
      </button>

      <button onClick={onTogglePolling} style={{
        background: isPolling ? "#450a0a" : "#052e16",
        border:`1px solid ${isPolling ? "#ef444466" : "#16a34a66"}`,
        borderRadius:7,
        color: isPolling ? "#fca5a5" : "#86efac",
        padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer",
      }}>
        {isPolling ? "⏹ Stop" : "▶ Auto-Scan"}
      </button>

      <div style={{ display:"flex", alignItems:"center", gap:5, marginLeft:"auto" }}>
        <span style={{ fontSize:10, color:"#475569" }}>every</span>
        {[10, 15, 30, 60].map(s => (
          <button key={s} onClick={() => onSetInterval(s)} style={{
            background: interval === s ? "#1e3a5f" : "none",
            border:`1px solid ${interval === s ? "#3b82f6" : "#1e2d45"}`,
            borderRadius:5, color: interval === s ? "#60a5fa" : "#475569",
            padding:"4px 7px", fontSize:10, cursor:"pointer",
            fontWeight: interval === s ? 700 : 400,
          }}>{s}s</button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Log tab
// ─────────────────────────────────────────────────────────────────────────────
function LogTab({ log }) {
  if (!log.length) return (
    <div style={{ textAlign:"center", padding:"60px 20px", color:"#334155", fontSize:13 }}>
      No detections yet. Run a scan to start logging.
    </div>
  );

  return (
    <div style={{ padding:14, display:"grid", gap:7 }}>
      {log.map(entry => (
        <div key={entry.id} style={{
          background:"#0d1420",
          border:`1px solid ${entry.train_present ? "#ef444433" : "#1e2d45"}`,
          borderRadius:8, padding:"9px 12px",
          display:"flex", alignItems:"flex-start", gap:10,
          animation:"slide-in 0.15s ease",
        }}>
          <div style={{
            width:7, height:7, borderRadius:"50%", marginTop:4, flexShrink:0,
            background: entry.train_present ? "#ef4444" : "#22c55e",
            boxShadow: entry.train_present ? "0 0 6px #ef4444" : "none",
          }} />
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:700, fontSize:12, color:"#f1f5f9" }}>{entry.crossingName}</span>
              <span style={{ fontSize:9, color:"#334155", fontFamily:"'JetBrains Mono', monospace" }}>
                {new Date(entry.loggedAt).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ fontSize:11, marginTop:2, color: entry.train_present ? "#fca5a5" : "#86efac" }}>
              {entry.train_present ? "🚂 TRAIN" : "✓ Clear"}
              {entry.direction && entry.direction !== "none" && ` · ${entry.direction}`}
              {entry.speed_estimate_mph && ` · ${entry.speed_estimate_mph} mph`}
              {entry.confidence != null && ` · ${Math.round(entry.confidence * 100)}% conf`}
            </div>
            {entry.notes && (
              <div style={{ fontSize:10, color:"#4b5563", marginTop:2, fontStyle:"italic" }}>
                {entry.notes}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// About tab
// ─────────────────────────────────────────────────────────────────────────────
function AboutTab() {
  const cameraCrossings  = CROSSINGS.filter(c =>  c.hasCamera);
  const noCamCrossings   = CROSSINGS.filter(c => !c.hasCamera);

  return (
    <div style={{ padding:14, display:"grid", gap:10 }}>
      <InfoCard title="How Vision Detection Works">
        <p>On each scan cycle, the app:</p>
        <ol style={{ paddingLeft:16, marginTop:6, lineHeight:1.9, fontSize:12, color:"#94a3b8" }}>
          <li>Calls a serverless function to resolve the live snapshot URL from the Jefferson Parish ipcamlive feed</li>
          <li>Fetches the current JPEG snapshot (server-side, no CORS issues)</li>
          <li>Sends the image to <strong style={{ color:"#f1f5f9" }}>Claude Sonnet</strong> Vision via a server-side proxy</li>
          <li>Receives structured JSON: train present, direction, speed, gates down, confidence</li>
          <li>Propagates physics-based ETAs to the four crossings with no cameras</li>
        </ol>
      </InfoCard>

      <InfoCard title="Live Camera Crossings">
        {cameraCrossings.map(c => (
          <CameraRow key={c.id} crossing={c} hasCamera />
        ))}
        <div style={{ fontSize:10, color:"#334155", marginTop:6 }}>
          Source: Jefferson Parish Rail Cameras (jeffparish.gov/676)
        </div>
      </InfoCard>

      <InfoCard title="Physics-Predicted Crossings (no camera)">
        {noCamCrossings.map(c => (
          <CameraRow key={c.id} crossing={c} hasCamera={false} />
        ))}
        <div style={{ fontSize:10, color:"#334155", marginTop:6 }}>
          ETAs calculated from: distance to Metairie Rd camera ÷ detected speed.
          Default assumed speed: 15 mph if motion blur is unclear.
        </div>
      </InfoCard>

      <InfoCard title="API Key">
        <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6 }}>
          The Anthropic API key is stored as a <strong style={{ color:"#f1f5f9" }}>Netlify environment variable</strong> (ANTHROPIC_API_KEY).
          It never touches the browser. Set it in your Netlify dashboard under{" "}
          <span style={{ fontFamily:"monospace", color:"#60a5fa" }}>Site → Environment variables</span>.
        </div>
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

function CameraRow({ crossing, hasCamera }) {
  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"6px 0", borderBottom:"1px solid #111827", fontSize:12,
    }}>
      <div>
        <span style={{ color:"#f1f5f9", fontWeight:600 }}>{crossing.name}</span>
        <span style={{ color:"#475569", fontSize:10, marginLeft:6 }}>DOT #{crossing.dot}</span>
      </div>
      <div style={{ textAlign:"right" }}>
        {hasCamera
          ? <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#60a5fa" }}>{crossing.alias}</span>
          : <span style={{ fontSize:10, color:"#1e2d45" }}>
              {Math.abs(crossing.distFromMetairie).toFixed(2)} mi west
            </span>
        }
      </div>
    </div>
  );
}
