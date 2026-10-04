import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
import trackData from '../data/maptracks.json'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'
import { fetchSnapshotImage } from '../lib/api'

const ALL = [...CORRIDOR, ...DOWNSTREAM]

const TRACK_COLORS = {
  'Back Belt Line': '#3b82f6',
  'CN McComb Subdivision': '#8b5cf6',
  'McComb Subdivision': '#8b5cf6',
  'UP Livonia Subdivision': '#e879f9',
  'Avondale Subdivision': '#e879f9',
}

const STATUS = {
  BLOCKED: { color: '#ef4444', glow: 'rgba(239,68,68,0.55)' },
  TRAIN: { color: '#f97316', glow: 'rgba(249,115,22,0.5)' },
  APPROACHING: { color: '#fbbf24', glow: 'rgba(251,191,36,0.45)' },
  CLEARING: { color: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
  CLEAR: { color: '#22c55e', glow: 'rgba(34,197,94,0.35)' },
  IDLE: { color: '#475569', glow: 'transparent' },
}

// Train marker position: interpolate along a straight line between source camera
// and the soonest ahead-crossing.
function trainPosition(propagated) {
  const entries = Object.entries(propagated)
    .filter(([, e]) => e?.mode === 'approaching' && e?.eta_mins != null && e?.distMiles != null)
  if (!entries.length) return null
  entries.sort((a, b) => a[1].eta_mins - b[1].eta_mins)
  const [, next] = entries[0]
  const from = trackData.crossings[next.sourceId]
  const to = trackData.crossings[next[0]]
  if (!from || !to) return null
  const speed = next.speed_mph || 15
  const legMins = (next.distMiles / speed) * 60
  const frac = Math.min(Math.max(next.eta_mins / legMins, 0), 1)
  return {
    lat: from.lat + (to.lat - from.lat) * (1 - frac),
    lng: from.lng + (to.lng - from.lng) * (1 - frac),
    label: next.sourceName,
    speed,
    dest: next[0],
    eta: next.eta_mins,
  }
}

function pinHtml(color, glow, urgent) {
  const size = urgent ? 22 : 15
  return `
    <div class="mtt-pin-wrap${urgent ? ' mtt-pin-urgent' : ''}" style="--pin:${color};--glow:${glow};--size:${size}px">
      <div class="mtt-pin-core"></div>
    </div>`
}

// ── Map tab — redesigned ─────────────────────────────────────────────
export default function Map({ detections, propagated, onSelect }) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const trainRef = useRef(null)
  const trailsRef = useRef([])
  const followRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [following, setFollowing] = useState(false)
  const [popData, setPopData] = useState(null) // {crossing, snapshot}

  const statusOf = useMemo(() => {
    const map = {}
    for (const c of ALL) {
      const direct = detections[c.id]
      const prop = propagated[c.id]
      if (direct?.train_present && direct?.crossing_blocked) map[c.id] = { ...STATUS.BLOCKED, label: 'BLOCKED', urgent: true }
      else if (direct?.train_present || prop?.mode === 'at-crossing') map[c.id] = { ...STATUS.TRAIN, label: 'TRAIN', urgent: true }
      else if (prop?.mode === 'approaching') map[c.id] = { ...STATUS.APPROACHING, label: `${Math.round(prop.eta_mins)} min`, urgent: prop.eta_mins <= 2 }
      else if (prop?.mode === 'clearing') map[c.id] = { ...STATUS.CLEARING, label: 'clearing' }
      else if (direct?.confidence >= 0.55 || prop) map[c.id] = { ...STATUS.CLEAR, label: 'CLEAR' }
      else map[c.id] = { ...STATUS.IDLE, label: null }
    }
    return map
  }, [detections, propagated])

  // ── init map ──
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('mtt-map', {
      center: [29.952, -90.19],
      zoom: 12,
      zoomControl: false,
      attributionControl: true,
    })
    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 20,
    }).addTo(map)

    // rail lines — casing + fill for a polished two-tone look
    for (const [name, segs] of Object.entries(trackData.tracks)) {
      for (const seg of segs) {
        L.polyline(seg, { color: '#0a0e16', weight: 7, opacity: 0.9 }).addTo(map)
        L.polyline(seg, {
          color: TRACK_COLORS[name] || '#64748b',
          weight: 3.5,
          opacity: 0.95,
          dashArray: name.includes('Industrial') ? '4 6' : null,
        }).bindTooltip(name, { sticky: true, className: 'mtt-track-tip' }).addTo(map)
      }
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    setReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = {}
      trainRef.current = null
      trailsRef.current = []
    }
  }, [])

  // ── crossing pins ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const c of ALL) {
      const pos = trackData.crossings[c.id]
      if (!pos) continue
      const st = statusOf[c.id]
      const icon = L.divIcon({
        className: 'mtt-pin',
        html: pinHtml(st.color, st.glow, st.urgent),
        iconSize: [st.urgent ? 22 : 15, st.urgent ? 22 : 15],
        iconAnchor: [st.urgent ? 11 : 7.5, st.urgent ? 11 : 7.5],
      })
      if (markersRef.current[c.id]) {
        markersRef.current[c.id].setIcon(icon)
      } else {
        const m = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: c.hasCamera ? 200 : 0 })
          .on('click', () => setPopData({ crossing: c }))
        m.addTo(map)
        markersRef.current[c.id] = m
      }
      // persistent ETA chip floating over approaching-crossing pins
      const existing = markersRef.current[`${c.id}:chip`]
      if (st.label && (st.urgent || st.color === STATUS.APPROACHING.color)) {
        const chip = L.tooltip({
          permanent: true,
          direction: 'top',
          offset: [0, -12],
          className: 'mtt-chip',
        }).setContent(st.label)
        if (existing) {
          existing.setContent(st.label)
        } else {
          markersRef.current[`${c.id}:chip`] = chip
          chip.setLatLng([pos.lat, pos.lng]).addTo(map)
        }
      } else if (existing) {
        map.removeLayer(existing)
        delete markersRef.current[`${c.id}:chip`]
      }
    }
  }, [ready, statusOf])

  // ── live train marker + trail ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pos = trainPosition(propagated)
    if (pos) {
      if (followRef.current) map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.5 })
      const icon = L.divIcon({
        className: 'mtt-train',
        html: `<div class="mtt-train-pulse" style="--glow:${STATUS.BLOCKED.glow}"><div class="mtt-train-emoji">🚂</div></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      if (trainRef.current) trainRef.current.setLatLng([pos.lat, pos.lng]).setIcon(icon)
      else trainRef.current = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 1000 }).addTo(map)
      trainRef.current.bindTooltip(`${pos.label} → ${pos.dest} · ${pos.speed} mph · ETA ${Math.round(pos.eta)}m`, { direction: 'top', className: 'mtt-train-tip' })

      // trail breadcrumb
      const trail = L.circleMarker([pos.lat, pos.lng], {
        radius: 3, color: STATUS.BLOCKED.color, weight: 1, opacity: 0.6, fillOpacity: 0.5,
      }).addTo(map)
      trailsRef.current.push(trail)
      if (trailsRef.current.length > 60) {
        map.removeLayer(trailsRef.current.shift())
      }
    } else {
      if (trainRef.current) {
        map.removeLayer(trainRef.current)
        trainRef.current = null
      }
      for (const t of trailsRef.current) map.removeLayer(t)
      trailsRef.current = []
    }
  }, [ready, propagated])

  const toggleFollow = useCallback(() => {
    followRef.current = !followRef.current
    setFollowing(followRef.current)
    if (followRef.current) {
      const pos = trainPosition(propagated)
      if (pos) mapRef.current?.panTo([pos.lat, pos.lng], { animate: true, duration: 0.5 })
    }
  }, [propagated])

  const fitCorridor = useCallback(() => {
    mapRef.current?.fitBounds(
      L.latLngBounds(ALL.filter((c) => trackData.crossings[c.id]).map((c) => {
        const p = trackData.crossings[c.id]
        return [p.lat, p.lng]
      })),
      { padding: [40, 40] }
    )
  }, [])

  // ── popup card: camera snapshot fetch ──
  useEffect(() => {
    if (!popData?.crossing?.alias) return
    let dead = false
    ;(async () => {
      try {
        const { online, snapshotUrl } = await fetch(
          `${'https://fascinating-platypus-46f604.netlify.app'}/.netlify/functions/snapshot-url?alias=${popData.crossing.alias}`,
          { signal: AbortSignal.timeout(10000) }
        ).then((r) => r.json())
        if (dead || !online || !snapshotUrl) return
        const img = await fetchSnapshotImage(snapshotUrl)
        if (!dead) setPopData((p) => p && ({ ...p, snapshot: `data:${img.mediaType};base64,${img.base64}` }))
      } catch {
        /* offline camera — card just shows no image */
      }
    })()
    return () => { dead = true }
  }, [popData])

  const closePopup = useCallback(() => setPopData(null), [])
  const trainPos = trainPosition(propagated)

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 96px)', minHeight: 460 }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap"
        rel="stylesheet"
      />
      <div id="mtt-map" style={{ position: 'absolute', inset: 0, background: '#080b10' }} />

      {/* top status strip */}
      <div className="mtt-glass mtt-strip">
        <span className="mtt-dot" style={{ background: trainPos ? STATUS.BLOCKED.color : STATUS.CLEAR.color,
          boxShadow: trainPos ? `0 0 10px ${STATUS.BLOCKED.glow}` : `0 0 10px ${STATUS.CLEAR.glow}` }} />
        <span className="mtt-strip-text">
          {trainPos ? `TRAIN ACTIVE — ${trainPos.label} → ${trainPos.dest}, ${Math.round(trainPos.eta)} min out · ${trainPos.speed} mph`
            : 'All crossings clear'}
        </span>
      </div>

      {/* floating controls */}
      <div className="mtt-controls">
        <button className="mtt-ctl" onClick={fitCorridor} title="Fit whole corridor">⤢</button>
        <button className={`mtt-ctl${following ? ' mtt-ctl-on' : ''}`} onClick={toggleFollow}
          disabled={!trainPos} style={{ opacity: trainPos ? 1 : 0.35 }} title="Follow the train">🎯</button>
      </div>

      {/* legend */}
      <div className="mtt-glass mtt-legend">
        <div className="mtt-lg"><i style={{ background: STATUS.BLOCKED.color }} /> blocked</div>
        <div className="mtt-lg"><i style={{ background: STATUS.TRAIN.color }} /> train</div>
        <div className="mtt-lg"><i style={{ background: STATUS.APPROACHING.color }} /> approaching</div>
        <div className="mtt-lg"><i style={{ background: STATUS.CLEARING.color }} /> clearing</div>
        <div className="mtt-lg"><i style={{ background: STATUS.CLEAR.color }} /> clear</div>
        <div className="mtt-lg mtt-lg-sep">
          <i style={{ background: TRACK_COLORS['Back Belt Line'] }} /> NS
          <i style={{ background: TRACK_COLORS['CN McComb Subdivision'], marginLeft: 8 }} /> CN
          <i style={{ background: TRACK_COLORS['UP Livonia Subdivision'], marginLeft: 8 }} /> UP
        </div>
      </div>

      {/* crossing popup card */}
      {popData && (
        <div className="mtt-glass mtt-pop" onClick={(e) => e.stopPropagation()}>
          <button className="mtt-pop-x" onClick={closePopup}>✕</button>
          <div className="mtt-pop-name">
            {popData.crossing.name}
            {statusOf[popData.crossing.id]?.label && (
              <span className="mtt-pop-badge" style={{
                background: statusOf[popData.crossing.id].color,
                boxShadow: `0 0 8px ${statusOf[popData.crossing.id].glow}`,
              }}>{statusOf[popData.crossing.id].label}</span>
            )}
          </div>
          <div className="mtt-pop-sub">{popData.crossing.area || popData.crossing.address}</div>
          {popData.snapshot && (
            <img className="mtt-pop-img" src={popData.snapshot} alt="camera snapshot" />
          )}
          {popData.crossing.alias && !popData.snapshot && (
            <div className="mtt-pop-img mtt-pop-img-loading">loading camera…</div>
          )}
          <div className="mtt-pop-row">
            {detections[popData.crossing.id]?.notes || 'No recent scan'}
          </div>
          <div className="mtt-pop-foot">
            {popData.crossing.hasCamera ? '📷 camera crossing' : 'predicted from corridor'}
          </div>
          <button className="mtt-pop-btn" onClick={() => { onSelect?.(popData.crossing); closePopup() }}>
            Open crossing →
          </button>
        </div>
      )}
    </div>
  )
}