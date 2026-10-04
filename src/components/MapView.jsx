import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import trackData from '../data/maptracks.json'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'

const ALL = [...CORRIDOR, ...DOWNSTREAM]

// Train marker position: interpolate along a straight line between source camera
// and the soonest ahead-crossing (good enough at corridor scale — curvature ignored).
function trainPosition(propagated) {
  const entries = Object.entries(propagated)
    .filter(([, e]) => e?.mode === 'approaching' && e?.eta_mins != null && e?.distMiles != null)
  if (!entries.length) return null
  // soonest ETA = closest to the camera
  entries.sort((a, b) => a[1].eta_mins - b[1].eta_mins)
  const [, next] = entries[0]
  const from = trackData.crossings[next.sourceId]
  const to = trackData.crossings[next[0]]
  if (!from || !to) return null
  // fraction remaining → position back from the target by its ETA share of the leg
  const speed = next.speed_mph || 15
  const legMins = (next.distMiles / speed) * 60
  const frac = Math.min(Math.max(next.eta_mins / legMins, 0), 1)
  return {
    lat: from.lat + (to.lat - from.lat) * (1 - frac),
    lng: from.lng + (to.lng - from.lng) * (1 - frac),
    label: next.sourceName,
    speed,
  }
}

const TRACK_COLORS = {
  'Back Belt Line': '#3b82f6',
  'CN McComb Subdivision': '#8b5cf6',
  'McComb Subdivision': '#8b5cf6',
  'UP Livonia Subdivision': '#e879f9',
  'Avondale Subdivision': '#e879f9',
}

// Map tab: dark Leaflet map with rail lines, live crossing pins, moving train marker.
export default function Map({ detections, propagated, onSelect }) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const trainRef = useRef(null)
  const [ready, setReady] = useState(false)

  const statusOf = useMemo(() => {
    const map = {}
    for (const c of ALL) {
      const direct = detections[c.id]
      const prop = propagated[c.id]
      if (direct?.train_present && direct?.crossing_blocked) map[c.id] = { color: '#ef4444', label: 'BLOCKED' }
      else if (direct?.train_present || prop?.mode === 'at-crossing') map[c.id] = { color: '#f97316', label: 'TRAIN' }
      else if (prop?.mode === 'approaching') map[c.id] = { color: '#fbbf24', label: `≈ ${Math.round(prop.eta_mins)}m` }
      else if (prop?.mode === 'clearing') map[c.id] = { color: '#22d3ee', label: 'clearing' }
      else map[c.id] = { color: '#475569', label: null }
    }
    return map
  }, [detections, propagated])

  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('mtt-map', {
      center: [29.955, -90.185],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map

    // rail lines
    for (const [name, segs] of Object.entries(trackData.tracks)) {
      for (const seg of segs) {
        L.polyline(seg, {
          color: TRACK_COLORS[name] || '#64748b',
          weight: 3,
          opacity: 0.85,
        }).bindTooltip(name, { sticky: true }).addTo(map)
      }
    }
    setReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = {}
      trainRef.current = null
    }
  }, [])

  // crossing pins (re-render on status change)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const c of ALL) {
      const pos = trackData.crossings[c.id]
      if (!pos) continue
      const st = statusOf[c.id]
      const icon = L.divIcon({
        className: 'mtt-pin',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${st.color};border:2px solid #080b10;box-shadow:0 0 6px ${st.color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })
      if (markersRef.current[c.id]) {
        markersRef.current[c.id].setIcon(icon)
      } else {
        const m = L.marker([pos.lat, pos.lng], { icon })
          .bindTooltip(`${c.name}${st.label ? ` — ${st.label}` : ''}`, { direction: 'top' })
          .on('click', () => onSelect?.(c))
        m.addTo(map)
        markersRef.current[c.id] = m
      }
    }
  }, [ready, statusOf, onSelect])

  // live train marker
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pos = trainPosition(propagated)
    if (pos) {
      const icon = L.divIcon({
        className: 'mtt-train',
        html: '<div style="font-size:22px;filter:drop-shadow(0 0 4px #ef4444)">🚂</div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      if (trainRef.current) trainRef.current.setLatLng([pos.lat, pos.lng]).setIcon(icon)
      else trainRef.current = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 1000 }).addTo(map)
      trainRef.current.bindTooltip(`${pos.label} · ${pos.speed} mph`, { direction: 'top' })
    } else if (trainRef.current) {
      map.removeLayer(trainRef.current)
      trainRef.current = null
    }
  }, [ready, propagated])

  return (
    <div style={{ padding: 0, position: 'relative' }}>
      <div id="mtt-map" style={{ height: 'calc(100vh - 130px)', minHeight: 420, background: '#080b10' }} />
      <div
        style={{
          position: 'absolute', bottom: 10, left: 10, zIndex: 1000,
          background: 'rgba(8,11,16,0.85)', border: '1px solid #1e2d45', borderRadius: 8,
          padding: '6px 10px', display: 'flex', gap: 12, fontSize: 9, color: '#64748b',
        }}
      >
        <span><span style={{ color: '#ef4444' }}>●</span> blocked</span>
        <span><span style={{ color: '#f97316' }}>●</span> train</span>
        <span><span style={{ color: '#fbbf24' }}>●</span> approaching</span>
        <span><span style={{ color: '#22d3ee' }}>●</span> clearing</span>
        <span><span style={{ color: '#475569' }}>●</span> clear</span>
        <span style={{ opacity: 0.6 }}>— NS</span>
        <span style={{ opacity: 0.6 }}>— CN/UP</span>
      </div>
    </div>
  )
}