import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
import trackData from '../data/maptracks.json'
import trackRef from '../data/trackref.json'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'

const ALL = [...CORRIDOR, ...DOWNSTREAM]

// ── Train position engine ────────────────────────────────────────────
// Given a detection (camera, direction, speed, timestamp), interpolate
// the train's CURRENT position along the actual track geometry.

function interpolateOnTrack(mileMark, ref) {
  // ref = { polyline: [[lat,lng],...], mileRef: [0, 0.02, ...] }
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

function estimateTrainState(detections, propagated) {
  // Find any active train detection from cameras
  const cameras = CORRIDOR.filter((c) => c.hasCamera)
  const active = []

  for (const cam of cameras) {
    const det = detections[cam.id]
    if (!det?.train_present || !det?.fetchedAt) continue
    const ref = trackRef.backBelt
    const sourceMile = ref.crossings[cam.id]
    if (sourceMile == null) continue

    const speed = det.speed_estimate_mph || 15
    const dir = det.direction
    if (!dir || dir === 'none') continue

    const elapsedMin = (Date.now() - det.fetchedAt) / 60000
    const milesTraveled = (speed / 60) * elapsedMin
    const sign = dir === 'westbound' ? 1 : -1 // mile markers increase west
    const currentMile = sourceMile + sign * milesTraveled

    // Clamp to track bounds
    const maxMile = ref.mileRef[ref.mileRef.length - 1]
    const clampedMile = Math.max(0, Math.min(maxMile, currentMile))
    const pos = interpolateOnTrack(clampedMile, ref)

    // Compute ETAs to each crossing ahead
    const etas = {}
    for (const [cid, cMile] of Object.entries(ref.crossings)) {
      const dist = (cMile - currentMile) * sign
      if (dist > 0.05) { // ahead of train
        etas[cid] = { mins: (dist / speed) * 60, distMiles: dist }
      }
    }

    // CN McComb extension for westbound trains past Labarre
    if (dir === 'westbound' && currentMile >= ref.crossings.labarre - 0.1) {
      const cnRef = trackRef.cnMcComb
      const junctionMile = cnRef.mileRef[cnRef.mileRef.length - 1] // CN runs east(high)→west(low)
      const pastLabarre = currentMile - ref.crossings.labarre
      for (const [cid, cMile] of Object.entries(cnRef.crossings)) {
        const dist = junctionMile - cMile + pastLabarre // approximate
        if (dist > 0) {
          etas[cid] = { mins: (dist / speed) * 60, distMiles: dist }
        }
      }
    }

    active.push({
      lat: pos[0], lng: pos[1],
      speed, direction: dir,
      source: cam.name,
      elapsedMin,
      currentMile, clampedMile,
      etas,
      stopped: dir === 'stopped',
    })
  }

  // Also check propagated entries as fallback
  if (!active.length && Object.keys(propagated).length) {
    for (const [, entry] of Object.entries(propagated)) {
      if (entry?.mode === 'approaching' && entry?.sourceId && entry?.eta_mins != null) {
        const ref = trackRef.backBelt
        const sourceMile = ref.crossings[entry.sourceId]
        if (sourceMile == null) continue
        const speed = entry.speed_mph || 15
        const targetMile = ref.crossings[entry[0]]
        if (targetMile == null) continue
        const currentMile = sourceMile + (targetMile - sourceMile) * (1 - entry.eta_mins / ((Math.abs(targetMile - sourceMile) / speed) * 60))
        const pos = interpolateOnTrack(Math.max(0, currentMile), ref)
        active.push({ lat: pos[0], lng: pos[1], speed, direction: entry.direction || '?', source: entry.sourceName, elapsedMin: 0, etas: {} })
        break
      }
    }
  }

  return active
}

// ── Component ────────────────────────────────────────────────────────
export default function Map({ detections, propagated, onSelect }) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const trainRef = useRef(null)
  const trailRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0) // drives re-interpolation every second

  // Tick every second to update train position in real time
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const trains = useMemo(() => estimateTrainState(detections, propagated), [detections, propagated, tick])
  const trainActive = trains.length > 0

  // ── init map ──
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('mtt-map', {
      center: [29.975, -90.155],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
      tap: true,
      touchZoom: true,
      dragging: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 19,
      className: 'mtt-dark-tiles',
    }).addTo(map)

    // rail tracks — subtle when no train, brighter when active (handled via CSS class)
    for (const [name, segs] of Object.entries(trackData.tracks)) {
      const color = name.includes('Back Belt') ? '#3b82f6'
        : name.includes('McComb') ? '#8b5cf6' : '#e879f9'
      for (const seg of segs) {
        L.polyline(seg, { color: '#0a0e16', weight: 8, opacity: 0.85, className: 'mtt-track-casing' }).addTo(map)
        L.polyline(seg, { color, weight: 3.5, opacity: 0.7, className: 'mtt-track-line' }).addTo(map)
      }
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    setReady(true)
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; trainRef.current = null }
  }, [])

  // ── crossing markers — only show when relevant ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    for (const c of ALL) {
      const pos = trackData.crossings[c.id]
      if (!pos) continue
      const det = detections[c.id]
      const prop = propagated[c.id]
      const train = trains[0]
      const etaInfo = train?.etas?.[c.id]

      // Determine what to show
      let show = false
      let color = '#334155'
      let label = c.short || c.name.split(' ')[0]
      let sublabel = ''
      let size = 28
      let urgent = false

      if (det?.train_present && det?.crossing_blocked) {
        show = true; color = '#ef4444'; sublabel = 'BLOCKED'; size = 36; urgent = true
      } else if (det?.train_present) {
        show = true; color = '#f97316'; sublabel = 'TRAIN'; size = 34; urgent = true
      } else if (etaInfo && etaInfo.mins < 15) {
        show = true; color = '#fbbf24'; sublabel = `${Math.round(etaInfo.mins)}m`; size = 32; urgent = etaInfo.mins < 2
      } else if (prop?.mode === 'approaching') {
        show = true; color = '#fbbf24'; sublabel = `${Math.round(prop.eta_mins)}m`; size = 30
      } else if (prop?.mode === 'clearing') {
        show = true; color = '#22d3ee'; sublabel = 'clearing'; size = 28
      } else if (c.hasCamera) {
        show = true; color = '#334155'; sublabel = '' // always show camera crossings faintly
      }
      // Non-camera crossings only appear when a train is relevant to them
      if (!show) {
        if (markersRef.current[c.id]) {
          map.removeLayer(markersRef.current[c.id])
          delete markersRef.current[c.id]
        }
        continue
      }

      const icon = L.divIcon({
        className: 'mtt-xing',
        html: `<div class="mtt-xing-pin${urgent ? ' mtt-xing-urgent' : ''}" style="--c:${color};--s:${size}px">
          <div class="mtt-xing-label">${label}</div>
          ${sublabel ? `<div class="mtt-xing-sub" style="background:${color}">${sublabel}</div>` : ''}
        </div>`,
        iconSize: [size * 2.5, size],
        iconAnchor: [size * 1.25, size / 2],
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
  }, [ready, detections, propagated, trains, onSelect])

  // ── train marker — the star of the show ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (trains.length > 0) {
      const t = trains[0]
      const icon = L.divIcon({
        className: 'mtt-loco',
        html: `<div class="mtt-loco-wrap">
          <div class="mtt-loco-ring"></div>
          <div class="mtt-loco-ring mtt-loco-ring2"></div>
          <div class="mtt-loco-icon">🚂</div>
        </div>
        <div class="mtt-loco-info">
          <span class="mtt-loco-speed">${t.speed} mph</span>
          <span class="mtt-loco-dir">${t.direction === 'westbound' ? '← W' : t.direction === 'eastbound' ? 'E →' : t.direction}</span>
        </div>`,
        iconSize: [80, 60],
        iconAnchor: [40, 25],
      })

      if (trainRef.current) {
        trainRef.current.setLatLng([t.lat, t.lng]).setIcon(icon)
      } else {
        trainRef.current = L.marker([t.lat, t.lng], { icon, zIndexOffset: 2000 }).addTo(map)
      }

      // Trail line showing path from source
      const ref = trackRef.backBelt
      const sourceCam = CORRIDOR.find((c) => c.name === t.source)
      if (sourceCam && ref.crossings[sourceCam.id] != null) {
        const startMile = ref.crossings[sourceCam.id]
        const endMile = t.clampedMile ?? startMile
        const lo = Math.min(startMile, endMile)
        const hi = Math.max(startMile, endMile)
        const trailPts = []
        for (let i = 0; i < ref.mileRef.length; i++) {
          if (ref.mileRef[i] >= lo && ref.mileRef[i] <= hi) {
            trailPts.push(ref.polyline[i])
          }
        }
        if (trailPts.length > 1) {
          if (trailRef.current) map.removeLayer(trailRef.current)
          trailRef.current = L.polyline(trailPts, {
            color: '#ef4444', weight: 5, opacity: 0.6,
            dashArray: '8 6', className: 'mtt-trail',
          }).addTo(map)
        }
      }
    } else {
      if (trainRef.current) { map.removeLayer(trainRef.current); trainRef.current = null }
      if (trailRef.current) { map.removeLayer(trailRef.current); trailRef.current = null }
    }
  }, [ready, trains])

  // Auto-pan to train on first appearance
  const prevTrainActive = useRef(false)
  useEffect(() => {
    if (trainActive && !prevTrainActive.current && mapRef.current && trains[0]) {
      mapRef.current.flyTo([trains[0].lat, trains[0].lng], 15, { duration: 1.2 })
    }
    prevTrainActive.current = trainActive
  }, [trainActive, trains])

  const fitCorridor = useCallback(() => {
    const pts = ALL.filter((c) => trackData.crossings[c.id]).map((c) => {
      const p = trackData.crossings[c.id]
      return [p.lat, p.lng]
    })
    if (trains[0]) pts.push([trains[0].lat, trains[0].lng])
    mapRef.current?.fitBounds(L.latLngBounds(pts), { padding: [50, 50] })
  }, [trains])

  const t = trains[0]

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 96px)', minHeight: 460, touchAction: 'manipulation' }}>
      <div id="mtt-map" style={{ position: 'absolute', inset: 0, background: '#080b10' }} />

      {/* status banner — train-first */}
      {trainActive && t ? (
        <div className="mtt-glass mtt-banner mtt-banner-active">
          <div className="mtt-banner-dot mtt-pulse" />
          <div className="mtt-banner-text">
            <div className="mtt-banner-title">
              🚂 Train on corridor — {t.speed} mph {t.direction}
            </div>
            <div className="mtt-banner-sub">
              detected at {t.source} · {Math.round(t.elapsedMin * 60)}s ago
              {Object.entries(t.etas).length > 0 && (() => {
                const next = Object.entries(t.etas).sort((a, b) => a[1].mins - b[1].mins)[0]
                const xing = ALL.find((c) => c.id === next[0])
                return ` · next: ${xing?.short || next[0]} in ${Math.round(next[1].mins)}m`
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="mtt-glass mtt-banner mtt-banner-clear">
          <div className="mtt-banner-text">
            <div className="mtt-banner-title" style={{ color: '#64748b' }}>
              No trains on corridor
            </div>
            <div className="mtt-banner-sub">
              cameras scanning every 5 min · last check {
                (() => {
                  const cams = CORRIDOR.filter((c) => c.hasCamera && detections[c.id]?.fetchedAt)
                  if (!cams.length) return 'pending'
                  const latest = Math.max(...cams.map((c) => detections[c.id].fetchedAt))
                  const ago = Math.round((Date.now() - latest) / 60000)
                  return ago < 1 ? 'just now' : `${ago}m ago`
                })()
              }
            </div>
          </div>
        </div>
      )}

      {/* floating controls — big touch targets */}
      <div className="mtt-fab-row">
        <button className="mtt-fab" onClick={fitCorridor} title="Fit corridor">
          <span style={{ fontSize: 18 }}>⤢</span>
        </button>
        {trainActive && (
          <button className="mtt-fab mtt-fab-train" onClick={() => {
            if (t) mapRef.current?.flyTo([t.lat, t.lng], 15, { duration: 0.8 })
          }} title="Go to train">
            <span style={{ fontSize: 18 }}>🚂</span>
          </button>
        )}
      </div>
    </div>
  )
}