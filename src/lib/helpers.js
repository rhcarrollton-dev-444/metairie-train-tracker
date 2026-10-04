import { CORRIDOR, DOWNSTREAM, DEFAULT_SPEED_MPH, minutesPerMile } from '../data/crossings'

// Physics ETA propagation. Given a detection at `source` (a corridor crossing with a
// camera, or a community report), estimate the status of the other corridor crossings
// and connected downstream crossings on CN.
//
// A train moves toward increasing distFromMetairie when eastbound, toward decreasing when
// westbound. Crossings AHEAD of it (in its travel direction) are "approaching" (with an
// ETA = minutesPerMile(speed) * distance); crossings BEHIND it are "clearing".
//
// Westbound trains continue through the Labarre junction onto CN McComb track (Little Farms,
// Central, Filmore, George). Eastbound trains stay on NS Back Belt (they don't jump from CN
// onto NS).
//
// This is a generalization of the original app, which only handled crossings WEST of the
// source and so only worked when the source was metairie (the easternmost camera). It now
// produces correct propagation for a community report filed at any corridor crossing, and
// extends westbound trains onto the CN chain.
export function propagate(detection, source) {
  if (!detection?.train_present || !detection?.direction || detection.direction === 'none') return {}
  if (detection.direction === 'stopped') return {}
  const speed = detection.speed_estimate_mph || DEFAULT_SPEED_MPH
  const eastbound = detection.direction === 'eastbound'
  const result = {}

  // Propagate within the Old Metairie corridor (NS Back Belt)
  for (const c of CORRIDOR) {
    if (c.id === source.id) continue
    const delta = c.distFromMetairie - source.distFromMetairie
    if (delta === 0) continue
    const distMiles = Math.abs(delta)
    const baseConf = detection.confidence ?? 0.5
    const ahead = eastbound ? delta > 0 : delta < 0
    if (ahead) {
      result[c.id] = {
        mode: 'approaching',
        eta_mins: minutesPerMile(speed) * distMiles,
        direction: detection.direction,
        speed_mph: speed,
        confidence: Math.max(0, baseConf - 0.1),
        sourceId: source.id,
        sourceName: source.name,
        distMiles,
        propagatedAt: Date.now(),
      }
    } else {
      result[c.id] = {
        mode: 'clearing',
        eta_mins: null,
        direction: detection.direction,
        speed_mph: speed,
        confidence: Math.max(0, baseConf - 0.2),
        sourceId: source.id,
        sourceName: source.name,
        distMiles,
        propagatedAt: Date.now(),
      }
    }
  }

  // Extend westbound trains through the junction onto CN McComb
  if (!eastbound) {
    const cnCrossings = DOWNSTREAM.filter((c) => c.corridor === 'cn' && c.distFromMetairie != null)
    for (const c of cnCrossings) {
      const delta = c.distFromMetairie - source.distFromMetairie
      if (delta >= 0) continue // CN crossings are all west (negative distFromMetairie)
      const distMiles = Math.abs(delta)
      const baseConf = detection.confidence ?? 0.5
      result[c.id] = {
        mode: 'approaching',
        eta_mins: minutesPerMile(speed) * distMiles,
        direction: detection.direction,
        speed_mph: speed,
        confidence: Math.max(0, baseConf - 0.15), // slightly lower confidence crossing junction
        sourceId: source.id,
        sourceName: source.name,
        distMiles,
        propagatedAt: Date.now(),
        crossedJunction: true,
      }
    }
  }

  return result
}

// Relative "Xs ago" formatting.
export function relativeTime(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ETA minutes -> display string.
export function formatEta(mins) {
  if (mins == null) return '—'
  if (mins <= 0) return 'NOW'
  if (mins < 1) return '< 1 min'
  return `~${Math.round(mins)} min`
}

// Confidence -> HIGH/MED/LOW badge color.
export function confidenceBadge(c) {
  if (c >= 0.85) return { label: 'HIGH', color: '#22c55e' }
  if (c >= 0.6) return { label: 'MED', color: '#f59e0b' }
  return { label: 'LOW', color: '#6b7280' }
}

// Status badge for a crossing given its direct detection and propagated entry.
// Returns { label, color, bg, border, urgent }.
export function statusBadge(crossing, directMap, propagatedMap) {
  const direct = directMap[crossing.id]
  const prop = propagatedMap[crossing.id]
  if (crossing.hasCamera && direct) {
    if (direct.train_present && direct.crossing_blocked)
      return { label: 'BLOCKED', color: '#ef4444', bg: '#450a0a', border: '#ef4444', urgent: true }
    if (direct.train_present)
      return { label: 'TRAIN', color: '#f97316', bg: '#2d1200', border: '#f97316', urgent: true }
    if (direct.confidence >= 0.55)
      return { label: 'CLEAR', color: '#22c55e', bg: '#052e16', border: '#22c55e', urgent: false }
    return { label: 'SCANNING', color: '#f59e0b', bg: '#1c1400', border: '#f59e0b', urgent: false }
  }
  if (prop) {
    if (prop.mode === 'clearing')
      return { label: 'CLEARING', color: '#a78bfa', bg: '#1a1530', border: '#7c3aed', urgent: false }
    if (prop.eta_mins <= 0)
      return { label: 'BLOCKED', color: '#ef4444', bg: '#450a0a', border: '#ef4444', urgent: false }
    if (prop.eta_mins < 3)
      return { label: `ETA ${formatEta(prop.eta_mins)}`, color: '#f97316', bg: '#2d1200', border: '#f97316', urgent: false }
    if (prop.eta_mins < 8)
      return { label: `ETA ${formatEta(prop.eta_mins)}`, color: '#f59e0b', bg: '#1c1400', border: '#f59e0b', urgent: false }
    return { label: `ETA ${formatEta(prop.eta_mins)}`, color: '#60a5fa', bg: '#0c1a2e', border: '#3b82f6', urgent: false }
  }
  return {
    label: crossing.hasCamera ? 'OFFLINE' : 'NO CAMERA',
    color: '#374151',
    bg: '#0d0d0d',
    border: '#1f2937',
    urgent: false,
  }
}

// localStorage helpers (JSON, swallow errors).
export function loadStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
export function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// Mark server-propagated entries with source metadata.
export function markServerPropagated(propagatedMap, ts) {
  const out = {}
  for (const [id, entry] of Object.entries(propagatedMap)) {
    out[id] = { ...entry, sourceId: 'metairie', propagatedAt: ts || Date.now(), fromServer: true }
  }
  return out
}