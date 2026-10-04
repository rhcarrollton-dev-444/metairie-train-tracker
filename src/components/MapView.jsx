import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
import trackData from '../data/maptracks.json'
import trackRef from '../data/trackref.json'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'

const ALL = [...CORRIDOR, ...DOWNSTREAM]
const ALL_WITH_CAMERA = ALL.filter((c) => c.hasCamera || c.alias)

// ── Train position engine ────────────────────────────────────────────
// Uses ANY camera detection (not just corridor) to place a train on the map.

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
  // Determine which track reference a crossing sits on
  if (trackRef.backBelt.crossings[crossing.id] != null) return { ref: trackRef.backBelt, name: 'backBelt' }
  if (trackRef.cnMcComb.crossings[crossing.id] != null) return { ref: trackRef.cnMcComb, name: 'cnMcComb' }
  return null
}

function estimateTrainPositions(detections, propagated, serverStatus) {
  const trains = []

  // Check ALL cameras for active detections
  for (const cam of ALL_WITH_CAMERA) {
    // Check server status cameras first (freshest data from the 5-min cron)
    const serverCam = serverStatus?.cameras?.[cam.id] || (cam.id === 'metairie' ? serverStatus?.metairie : null)
    const localDet = detections[cam.id]

    // Use whichever is fresher
    const det = localDet?.fetchedAt > (serverCam?.checkedAt || 0) ? localDet : serverCam
    if (!det?.train_present) continue

    const tref = getTrackRef(cam)
    // If crossing isn't on our tracked lines, just place it at the crossing coords
    const pos = trackData.crossings[cam.id]
    if (!pos) continue

    if (!tref) {
      // UP corridor crossings (avondale, liveoak, willswood) — no track ref, pin at crossing
      trains.push({
        lat: pos.lat, lng: pos.lng,
        speed: det.speed_estimate_mph || 15,
        direction: det.direction || '?',
        source: cam.short || cam.name,
        sourceId: cam.id,
        elapsedMin: det.fetchedAt ? (Date.now() - det.fetchedAt) / 60000 : det.checkedAt ? (Date.now() - det.checkedAt) / 60000 : 0,
        etas: {},
        onTrack: false,
        corridor: cam.corridor || 'ns',
      })
      continue
    }

    const { ref } = tref
    const sourceMile = ref.crossings[cam.id]
    const speed = det.speed_estimate_mph || 15
    const dir = det.direction
    const fetchedAt = det.fetchedAt || det.checkedAt || Date.now()
    const elapsedMin = (Date.now() - fetchedAt) / 60000

    if (!dir || dir === 'none' || dir === 'stopped') {
      // Stopped or unknown direction — pin at the crossing
      trains.push({
        lat: pos.lat, lng: pos.lng,
        speed: dir === 'stopped' ? 0 : speed,
        direction: dir || 'stopped',
        source: cam.short || cam.name,
        sourceId: cam.id,
        elapsedMin,
        etas: {},
        onTrack: true,
        stopped: true,
        corridor: cam.corridor || 'ns',
      })
      continue
    }

    // Interpolate position along track
    const milesTraveled = (speed / 60) * elapsedMin
    // Back Belt: mile markers increase west. CN: mile markers decrease west.
    const westSign = tref.name === 'backBelt' ? 1 : -1
    const sign = dir === 'westbound' ? westSign : -westSign
    const currentMile = sourceMile + sign * milesTraveled
    const maxMile = ref.mileRef[ref.mileRef.length - 1]
    const clampedMile = Math.max(0, Math.min(maxMile, currentMile))
    const interpolated = interpolateOnTrack(clampedMile, ref)

    // ETAs to crossings ahead
    const etas = {}
    for (const [cid, cMile] of Object.entries(ref.crossings)) {
      const dist = (cMile - currentMile) * sign
      if (dist > 0.02) {
        etas[cid] = { mins: (dist / speed) * 60, distMiles: dist }
      }
    }

    trains.push({
      lat: interpolated[0], lng: interpolated[1],
      speed, direction: dir,
      source: cam.short || cam.name,
      sourceId: cam.id,
      elapsedMin,
      currentMile: clampedMile,
      etas,
      onTrack: true,
      corridor: cam.corridor || 'ns',
    })
  }

  return trains
}

// ── Component ────────────────────────────────────────────────────────
export default function Map({ detections, propagated, onSelect, serverStatus }) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const trainMarkersRef = useRef([])
  const trailRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)

  // Tick every second for real-time interpolation
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const trains = useMemo(
    () => estimateTrainPositions(detections, propagated, serverStatus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detections, propagated, serverStatus, tick]
  )
  const anyTrain = trains.length > 0

  // ── init map ──
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('mtt-map', {
      center: [29.965, -90.19],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      tap: true, touchZoom: true, dragging: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 19,
      className: 'mtt-dark-tiles',
    }).addTo(map)

    // rail tracks
    for (const [name, segs] of Object.entries(trackData.tracks)) {
      const color = name.includes('Back Belt') ? '#3b82f6'
        : name.includes('McComb') ? '#8b5cf6' : '#e879f9'
      for (const seg of segs) {
        L.polyline(seg, { color: '#0a0e16', weight: 8, opacity: 0.85 }).addTo(map)
        L.polyline(seg, { color, weight: 3.5, opacity: 0.7 }).addTo(map)
      }
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    setReady(true)
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; trainMarkersRef.current = [] }
  }, [])

  // ── ALL crossing pins — ALWAYS visible ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    for (const c of ALL) {
      const pos = trackData.crossings[c.id]
      if (!pos) continue
      const det = detections[c.id]
      const serverCam = serverStatus?.cameras?.[c.id] || (c.id === 'metairie' ? serverStatus?.metairie : null)
      const prop = propagated[c.id]

      // Find ETA from any active train
      let etaMin = null
      for (const t of trains) {
        if (t.etas[c.id]) {
          etaMin = t.etas[c.id].mins
          break
        }
      }

      // Status
      const trainPresent = det?.train_present || serverCam?.train_present
      const blocked = trainPresent && (det?.crossing_blocked || serverCam?.crossing_blocked)
      let color, sublabel, urgent = false
      if (blocked) {
        color = '#ef4444'; sublabel = 'BLOCKED'; urgent = true
      } else if (trainPresent) {
        color = '#f97316'; sublabel = 'TRAIN'; urgent = true
      } else if (etaMin != null && etaMin < 15) {
        color = '#fbbf24'; sublabel = `${Math.ceil(etaMin)}m`; urgent = etaMin < 2
      } else if (prop?.mode === 'approaching') {
        color = '#fbbf24'; sublabel = `${Math.round(prop.eta_mins)}m`
      } else if (prop?.mode === 'clearing') {
        color = '#22d3ee'; sublabel = 'clearing'
      } else {
        color = '#22c55e'; sublabel = null // GREEN = clear
      }

      const label = c.short || c.name.split(' ')[0]
      const hasCamera = c.hasCamera || !!c.alias

      const icon = L.divIcon({
        className: 'mtt-xing',
        html: `<div class="mtt-xing-pin${urgent ? ' mtt-xing-urgent' : ''}" style="--c:${color}">
          <div class="mtt-xing-dot" style="background:${color};box-shadow:0 0 ${urgent ? 12 : 6}px ${color}"></div>
          <div class="mtt-xing-label">${label}${hasCamera ? ' 📷' : ''}</div>
          ${sublabel ? `<div class="mtt-xing-sub" style="background:${color}">${sublabel}</div>` : ''}
        </div>`,
        iconSize: [80, 44],
        iconAnchor: [40, 22],
      })

      if (markersRef.current[c.id]) {
        markersRef.current[c.id].setIcon(icon)
      } else {
        const m = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: urgent ? 500 : 100 })
          .on('click', () => onSelect?.(c))
        m.addTo(map)
        markersRef.current[c.id] = m
      }
    }
  }, [ready, detections, propagated, serverStatus, trains, onSelect])

  // ── train markers ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    // Clear old train markers
    for (const m of trainMarkersRef.current) map.removeLayer(m)
    trainMarkersRef.current = []
    if (trailRef.current) { map.removeLayer(trailRef.current); trailRef.current = null }

    for (const t of trains) {
      const icon = L.divIcon({
        className: 'mtt-loco',
        html: `<div class="mtt-loco-wrap">
          <div class="mtt-loco-ring"></div>
          <div class="mtt-loco-ring mtt-loco-ring2"></div>
          <div class="mtt-loco-icon">🚂</div>
        </div>
        <div class="mtt-loco-info">
          <span class="mtt-loco-speed">${t.stopped ? 'stopped' : `${t.speed} mph`}</span>
          <span class="mtt-loco-dir">${t.direction === 'westbound' ? '← W' : t.direction === 'eastbound' ? 'E →' : t.direction}</span>
        </div>`,
        iconSize: [80, 70],
        iconAnchor: [40, 28],
      })

      const m = L.marker([t.lat, t.lng], { icon, zIndexOffset: 2000 }).addTo(map)
      trainMarkersRef.current.push(m)

      // Trail for on-track trains
      if (t.onTrack && t.currentMile != null && t.sourceId) {
        const tref = getTrackRef(ALL.find((c) => c.id === t.sourceId))
        if (tref) {
          const { ref } = tref
          const sourceMile = ref.crossings[t.sourceId]
          if (sourceMile != null) {
            const lo = Math.min(sourceMile, t.currentMile)
            const hi = Math.max(sourceMile, t.currentMile)
            const trailPts = []
            for (let i = 0; i < ref.mileRef.length; i++) {
              if (ref.mileRef[i] >= lo && ref.mileRef[i] <= hi) trailPts.push(ref.polyline[i])
            }
            if (trailPts.length > 1) {
              trailRef.current = L.polyline(trailPts, {
                color: '#ef4444', weight: 5, opacity: 0.5,
                dashArray: '8 6', className: 'mtt-trail',
              }).addTo(map)
            }
          }
        }
      }
    }
  }, [ready, trains])

  // Auto-fly to first train on detection
  const prevTrainCount = useRef(0)
  useEffect(() => {
    if (trains.length > 0 && prevTrainCount.current === 0 && mapRef.current) {
      mapRef.current.flyTo([trains[0].lat, trains[0].lng], 15, { duration: 1.2 })
    }
    prevTrainCount.current = trains.length
  }, [trains])

  const fitCorridor = useCallback(() => {
    const pts = ALL.filter((c) => trackData.crossings[c.id]).map((c) => {
      const p = trackData.crossings[c.id]; return [p.lat, p.lng]
    })
    for (const t of trains) pts.push([t.lat, t.lng])
    mapRef.current?.fitBounds(L.latLngBounds(pts), { padding: [50, 50] })
  }, [trains])

  const goToTrain = useCallback((t) => {
    mapRef.current?.flyTo([t.lat, t.lng], 15, { duration: 0.8 })
  }, [])

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 96px)', minHeight: 460, touchAction: 'manipulation' }}>
      <div id="mtt-map" style={{ position: 'absolute', inset: 0, background: '#080b10' }} />

      {/* status banner */}
      {anyTrain ? (
        <div className="mtt-glass mtt-banner mtt-banner-active">
          <div className="mtt-banner-dot mtt-pulse" />
          <div className="mtt-banner-text">
            <div className="mtt-banner-title">
              {trains.length === 1
                ? `🚂 Train at ${trains[0].source} — ${trains[0].stopped ? 'stopped' : `${trains[0].speed} mph ${trains[0].direction}`}`
                : `🚂 ${trains.length} trains on corridor`}
            </div>
            <div className="mtt-banner-sub">
              {trains.map((t) => {
                const nextEta = Object.entries(t.etas).sort((a, b) => a[1].mins - b[1].mins)[0]
                const xing = nextEta ? ALL.find((c) => c.id === nextEta[0]) : null
                return xing ? `${t.source} → ${xing.short} in ${Math.round(nextEta[1].mins)}m` : t.source
              }).join(' · ')}
            </div>
          </div>
        </div>
      ) : (
        <div className="mtt-glass mtt-banner mtt-banner-clear">
          <div className="mtt-banner-text">
            <div className="mtt-banner-title" style={{ color: '#64748b' }}>No trains detected</div>
            <div className="mtt-banner-sub">
              {ALL_WITH_CAMERA.length} cameras scanning · all crossings clear
            </div>
          </div>
        </div>
      )}

      {/* FABs — big touch targets */}
      <div className="mtt-fab-row">
        <button className="mtt-fab" onClick={fitCorridor} title="Fit corridor">
          <span style={{ fontSize: 18 }}>⤢</span>
        </button>
        {trains.map((t, i) => (
          <button key={i} className="mtt-fab mtt-fab-train" onClick={() => goToTrain(t)} title={`Go to train at ${t.source}`}>
            <span style={{ fontSize: 18 }}>🚂</span>
          </button>
        ))}
      </div>
    </div>
  )
}