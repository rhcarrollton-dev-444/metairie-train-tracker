import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
import trackData from '../data/maptracks.json'
import trackRef from '../data/trackref.json'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'

const ALL = [...CORRIDOR, ...DOWNSTREAM]
const ALL_WITH_CAMERA = ALL.filter((c) => c.hasCamera || c.alias)

// ── Interpolation along real track geometry ──────────────────────────
function interpolateOnTrack(mileMark, ref) {
  const { polyline, mileRef } = ref
  if (mileMark <= mileRef[0]) return polyline[0]
  if (mileMark >= mileRef[mileRef.length - 1]) return polyline[polyline.length - 1]
  for (let i = 1; i < mileRef.length; i++) {
    if (mileRef[i] >= mileMark) {
      const t = (mileMark - mileRef[i - 1]) / (mileRef[i] - mileRef[i - 1])
      return [
        polyline[i - 1][0] + (polyline[i][0] - polyline[i - 1][0]) * t,
        polyline[i - 1][1] + (polyline[i][1] - polyline[i - 1][1]) * t,
      ]
    }
  }
  return polyline[polyline.length - 1]
}

function getTrackRef(crossing) {
  if (trackRef.backBelt.crossings[crossing.id] != null) return { ref: trackRef.backBelt, name: 'backBelt' }
  if (trackRef.cnMcComb.crossings[crossing.id] != null) return { ref: trackRef.cnMcComb, name: 'cnMcComb' }
  return null
}

function estimateTrains(detections, propagated, serverStatus) {
  const trains = []
  for (const cam of ALL_WITH_CAMERA) {
    const serverCam = serverStatus?.cameras?.[cam.id] || (cam.id === 'metairie' ? serverStatus?.metairie : null)
    const localDet = detections[cam.id]
    const det = localDet?.fetchedAt > (serverCam?.checkedAt || 0) ? localDet : serverCam
    if (!det?.train_present) continue

    const pos = trackData.crossings[cam.id]
    if (!pos) continue
    const tref = getTrackRef(cam)
    const speed = det.speed_estimate_mph || 15
    const dir = det.direction || 'unknown'
    const fetchedAt = det.fetchedAt || det.checkedAt || Date.now()
    const elapsedMin = (Date.now() - fetchedAt) / 60000

    if (!tref || !dir || dir === 'none' || dir === 'stopped') {
      trains.push({ lat: pos.lat, lng: pos.lng, speed: dir === 'stopped' ? 0 : speed, direction: dir, source: cam.short || cam.name, sourceId: cam.id, elapsedMin, etas: {}, onTrack: !!tref, stopped: dir === 'stopped', corridor: cam.corridor || 'ns' })
      continue
    }

    const { ref, name: tName } = tref
    const sourceMile = ref.crossings[cam.id]
    const milesTraveled = (speed / 60) * elapsedMin
    const westSign = tName === 'backBelt' ? 1 : -1
    const sign = dir === 'westbound' ? westSign : -westSign
    const currentMile = sourceMile + sign * milesTraveled
    const maxMile = ref.mileRef[ref.mileRef.length - 1]
    const clampedMile = Math.max(0, Math.min(maxMile, currentMile))
    const interpolated = interpolateOnTrack(clampedMile, ref)

    const etas = {}
    for (const [cid, cMile] of Object.entries(ref.crossings)) {
      const dist = (cMile - currentMile) * sign
      if (dist > 0.02) etas[cid] = { mins: (dist / speed) * 60, distMiles: dist }
    }

    // Build predicted path (track points AHEAD of current position)
    const predictedPath = []
    for (let i = 0; i < ref.mileRef.length; i++) {
      const ahead = (ref.mileRef[i] - clampedMile) * sign
      if (ahead > 0 && ahead < 5) predictedPath.push(ref.polyline[i])
    }

    // Build traveled path (track points BEHIND current position)
    const traveledPath = []
    const lo = Math.min(sourceMile, clampedMile)
    const hi = Math.max(sourceMile, clampedMile)
    for (let i = 0; i < ref.mileRef.length; i++) {
      if (ref.mileRef[i] >= lo && ref.mileRef[i] <= hi) traveledPath.push(ref.polyline[i])
    }

    trains.push({ lat: interpolated[0], lng: interpolated[1], speed, direction: dir, source: cam.short || cam.name, sourceId: cam.id, elapsedMin, currentMile: clampedMile, etas, onTrack: true, corridor: cam.corridor || 'ns', predictedPath, traveledPath })
  }
  return trains
}

// ── Component ────────────────────────────────────────────────────────
export default function Map({ detections, propagated, onSelect, serverStatus }) {
  const mapRef = useRef(null)
  const layersRef = useRef({ crossings: {}, trains: [], trails: [] })
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trains = useMemo(() => estimateTrains(detections, propagated, serverStatus), [detections, propagated, serverStatus, tick])

  // ── init map ──
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('mtt-map', {
      center: [29.968, -90.165],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
      tap: true, touchZoom: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM',
      maxZoom: 19,
      className: 'mtt-dark-tiles',
    }).addTo(map)

    // Rail tracks — glowing line effect (wide blur + narrow bright core)
    for (const [name, segs] of Object.entries(trackData.tracks)) {
      const color = name.includes('Back Belt') ? '#3b82f6' : name.includes('McComb') ? '#8b5cf6' : '#a855f7'
      for (const seg of segs) {
        // outer glow
        L.polyline(seg, { color, weight: 10, opacity: 0.15, className: 'mtt-glow' }).addTo(map)
        // mid glow
        L.polyline(seg, { color, weight: 5, opacity: 0.35 }).addTo(map)
        // bright core
        L.polyline(seg, { color, weight: 2, opacity: 0.9 }).addTo(map)
      }
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    setReady(true)
    return () => { map.remove(); mapRef.current = null; layersRef.current = { crossings: {}, trains: [], trails: [] } }
  }, [])

  // ── crossing markers — always visible ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    for (const c of ALL) {
      const pos = trackData.crossings[c.id]
      if (!pos) continue

      const det = detections[c.id]
      const serverCam = serverStatus?.cameras?.[c.id] || (c.id === 'metairie' ? serverStatus?.metairie : null)
      const trainPresent = det?.train_present || serverCam?.train_present
      const blocked = trainPresent && (det?.crossing_blocked || serverCam?.crossing_blocked)

      // ETA from any train
      let etaMin = null
      for (const t of trains) {
        if (t.etas[c.id]) { etaMin = t.etas[c.id].mins; break }
      }

      let dotColor, status
      if (blocked) { dotColor = '#ef4444'; status = 'BLOCKED' }
      else if (trainPresent) { dotColor = '#f97316'; status = 'TRAIN' }
      else if (etaMin != null && etaMin < 20) { dotColor = '#ef4444'; status = `${Math.ceil(etaMin)} min` }
      else { dotColor = '#22c55e'; status = null }

      const urgent = !!status
      const name = c.short || c.name.split(' ')[0]
      const cam = (c.hasCamera || c.alias) ? ' 📷' : ''

      const icon = L.divIcon({
        className: 'mtt-cx',
        html: `<div class="mtt-cx-wrap">
          <div class="mtt-cx-x" style="color:${dotColor}">⊗</div>
          <div class="mtt-cx-name">${name}${cam}</div>
          ${status ? `<div class="mtt-cx-eta${urgent && etaMin != null && etaMin < 3 ? ' mtt-pulse' : ''}" style="background:${dotColor}">${status}</div>` : ''}
        </div>`,
        iconSize: [90, 50],
        iconAnchor: [45, 25],
      })

      if (layersRef.current.crossings[c.id]) {
        layersRef.current.crossings[c.id].setIcon(icon)
      } else {
        const m = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: urgent ? 400 : 50 })
          .on('click', () => onSelect?.(c))
        m.addTo(map)
        layersRef.current.crossings[c.id] = m
      }
    }
  }, [ready, detections, propagated, serverStatus, trains, onSelect])

  // ── train markers + trails ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    // Clear previous
    for (const l of layersRef.current.trains) map.removeLayer(l)
    for (const l of layersRef.current.trails) map.removeLayer(l)
    layersRef.current.trains = []
    layersRef.current.trails = []

    for (const t of trains) {
      const isWest = t.direction === 'westbound'
      const trainColor = isWest ? '#ef4444' : '#3b82f6'

      // Traveled path (solid colored line)
      if (t.traveledPath?.length > 1) {
        const tl = L.polyline(t.traveledPath, { color: trainColor, weight: 4, opacity: 0.6 }).addTo(map)
        layersRef.current.trails.push(tl)
      }

      // Predicted path (dashed line ahead)
      if (t.predictedPath?.length > 1) {
        const pl = L.polyline(t.predictedPath, { color: trainColor, weight: 3, opacity: 0.35, dashArray: '6 8' }).addTo(map)
        layersRef.current.trails.push(pl)
      }

      // Train dot — glowing circle (not emoji)
      const trainIcon = L.divIcon({
        className: 'mtt-train-dot',
        html: `<div class="mtt-td-wrap" style="--tc:${trainColor}">
          <div class="mtt-td-ring"></div>
          <div class="mtt-td-ring mtt-td-ring2"></div>
          <div class="mtt-td-core"></div>
          <div class="mtt-td-arrow">${isWest ? '←' : '→'}</div>
        </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      })
      const tm = L.marker([t.lat, t.lng], { icon: trainIcon, zIndexOffset: 2000 }).addTo(map)
      layersRef.current.trains.push(tm)
    }
  }, [ready, trains])

  // Auto-fly on first detection
  const prevCount = useRef(0)
  useEffect(() => {
    if (trains.length > 0 && prevCount.current === 0 && mapRef.current) {
      mapRef.current.flyTo([trains[0].lat, trains[0].lng], 15, { duration: 1 })
    }
    prevCount.current = trains.length
  }, [trains])

  const fitAll = useCallback(() => {
    const pts = ALL.filter((c) => trackData.crossings[c.id]).map((c) => { const p = trackData.crossings[c.id]; return [p.lat, p.lng] })
    for (const t of trains) pts.push([t.lat, t.lng])
    mapRef.current?.fitBounds(L.latLngBounds(pts), { padding: [50, 80] })
  }, [trains])

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 96px)', minHeight: 460, touchAction: 'manipulation' }}>
      <div id="mtt-map" style={{ position: 'absolute', inset: 0, background: '#080b10' }} />

      {/* header strip */}
      <div className="mtt-glass mtt-hdr">
        <span className="mtt-hdr-title">Metairie Crossings</span>
        <span className={`mtt-hdr-live${trains.length > 0 ? ' mtt-hdr-live-on' : ''}`}>
          {trains.length > 0 ? '● Live' : '● Clear'}
        </span>
      </div>

      {/* directional labels */}
      <div className="mtt-dir mtt-dir-w">← Kenner</div>
      <div className="mtt-dir mtt-dir-e">New Orleans →</div>

      {/* train info cards at bottom — the key UX from concept #2 */}
      {trains.length > 0 && (
        <div className="mtt-cards">
          {trains.map((t, i) => {
            const isWest = t.direction === 'westbound'
            const nextEntries = Object.entries(t.etas).sort((a, b) => a[1].mins - b[1].mins)
            const next = nextEntries[0]
            const nextXing = next ? ALL.find((c) => c.id === next[0]) : null
            return (
              <div key={i} className="mtt-glass mtt-card" style={{ borderColor: isWest ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)' }}
                onClick={() => mapRef.current?.flyTo([t.lat, t.lng], 15, { duration: 0.8 })}>
                <div className="mtt-card-top">
                  <div className="mtt-card-dir" style={{ color: isWest ? '#fca5a5' : '#93c5fd' }}>
                    {isWest ? '← Westbound' : 'Eastbound →'}
                  </div>
                  <div className="mtt-card-eta" style={{ color: isWest ? '#ef4444' : '#3b82f6' }}>
                    {next ? `${Math.ceil(next[1].mins)} min` : t.stopped ? 'Stopped' : '—'}
                  </div>
                </div>
                <div className="mtt-card-dest">
                  {nextXing ? `to ${nextXing.name}` : `at ${t.source}`}
                </div>
                <div className="mtt-card-stats">
                  {t.speed > 0 && <span>{t.speed} mph</span>}
                  {next && <span>{next[1].distMiles.toFixed(1)} mi</span>}
                  <span>from {t.source}</span>
                </div>
                {/* upcoming crossings list */}
                {nextEntries.length > 1 && (
                  <div className="mtt-card-upcoming">
                    {nextEntries.slice(0, 3).map(([cid, info]) => {
                      const x = ALL.find((c) => c.id === cid)
                      return (
                        <div key={cid} className="mtt-card-next">
                          <span className="mtt-card-next-x" style={{ color: isWest ? '#ef4444' : '#3b82f6' }}>⊗</span>
                          <span className="mtt-card-next-name">{x?.short || cid}</span>
                          <span className="mtt-card-next-eta" style={{ color: isWest ? '#fca5a5' : '#93c5fd' }}>{Math.ceil(info.mins)} min</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* FABs */}
      <div className="mtt-fab-row">
        <button className="mtt-fab" onClick={fitAll}><span style={{ fontSize: 18 }}>⤢</span></button>
        {trains.map((t, i) => (
          <button key={i} className="mtt-fab mtt-fab-train" onClick={() => mapRef.current?.flyTo([t.lat, t.lng], 15, { duration: 0.8 })}>
            <span style={{ fontSize: 16 }}>🚂</span>
          </button>
        ))}
      </div>
    </div>
  )
}