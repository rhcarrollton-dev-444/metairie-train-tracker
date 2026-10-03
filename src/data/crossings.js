// Corridor crossings, ordered west -> east. `distFromMetairie` is miles from
// the Metairie Rd crossing (negative = west/upstream of it). Only `metairie`
// has a live JP camera (ipcamlive alias).
export const CORRIDOR = [
  { id: 'labarre', name: 'Labarre Rd', short: 'Labarre', address: 'N Labarre Rd', dot: '725708R', distFromMetairie: -1.462, hasCamera: true, alias: '6aaae2ff5b5bc' },
  { id: 'atherton', name: 'Atherton Dr', short: 'Atherton', address: 'Atherton Dr', dot: '725709X', distFromMetairie: -1.065, hasCamera: false, alias: null },
  { id: 'hollywood', name: 'Hollywood Dr', short: 'Hollywood', address: 'Hollywood Dr', dot: '725710S', distFromMetairie: -0.821, hasCamera: false, alias: null },
  { id: 'farnham', name: 'Farnham Pl', short: 'Farnham', address: 'Farnham Pl', dot: '725711Y', distFromMetairie: -0.307, hasCamera: false, alias: null },
  { id: 'metairie', name: 'Metairie Rd', short: 'Metairie Rd', address: 'Metairie Rd / Frisco Ave', dot: '725712F', distFromMetairie: 0, hasCamera: true, alias: '62fa4c1fb9f5c' },
]

// Downstream / regional crossings used by the "Watch Cameras" panel. Each has
// an ipcamlive alias and an area label. These are scanned server-side to learn
// which correlate with the Old Metairie corridor.
//
// Crossings west of the Labarre junction (29.97075, -90.16399) on CN McComb
// track have distFromMetairie and corridor='cn' — westbound trains propagate 
// through the junction onto CN. [OSM_REFINEMENT_NEEDED: distances are estimates
// based on typical metro spacing; rebuild from stitched CN polyline.]
//
// Live Oak, Willswood, and Avondale are on a separate UP corridor (Livonia/
// Avondale subdivisions) and do not connect to Old Metairie near the area.
export const DOWNSTREAM = [
  { id: 'littlefarms', name: 'Little Farms Ave', short: 'Little Farms', alias: '62b47da483e1f', area: 'River Ridge', distFromMetairie: -3.5, corridor: 'cn' },
  { id: 'central', name: 'Central Ave', short: 'Central', alias: '63609c3400e64', area: 'West Bank', distFromMetairie: -4.8, corridor: 'cn' },
  { id: 'filmore', name: 'Filmore St', short: 'Filmore', alias: '6529556348194', area: 'Jefferson', distFromMetairie: -5.5, corridor: 'cn' },
  { id: 'george', name: 'George St', short: 'George', alias: '635c0c64414c1', area: 'Jefferson', distFromMetairie: -5.9, corridor: 'cn' },
  { id: 'avondale', name: 'Avondale Garden Rd', short: 'Avondale', alias: '635c0abb11126', area: 'Avondale', distFromMetairie: null, corridor: 'up' },
  { id: 'liveoak', name: 'Live Oak Blvd', short: 'Live Oak', alias: '635c1059a967e', area: 'Waggaman', distFromMetairie: null, corridor: 'up' },
  { id: 'willswood', name: 'Willswood Ln', short: 'Willswood', alias: '635c112681056', area: 'Waggaman', distFromMetairie: null, corridor: 'up' },
]

// All crossings with a camera alias (metairie + downstream), for reference.
export const CAMERA_CROSSINGS = [
  ...CORRIDOR.filter((c) => c.hasCamera).map((c) => ({ id: c.id, name: c.name, alias: c.alias })),
  ...DOWNSTREAM.map((c) => ({ id: c.id, name: c.name, alias: c.alias })),
]

export const DEFAULT_SPEED_MPH = 15 // dp — fallback when a detection has no speed estimate
// fp — minutes-per-mile from a speed in mph; used by the propagation ETA math.
export const minutesPerMile = (mph) => 60 / Math.max(mph, 1)

export const CLEAR_STREAK_REQUIRED = 3 // Mc — consecutive clear scans to fire ALL CLEAR
export const MAX_SCAN_LOG = 500 // ks — max scanLog entries persisted to localStorage

// Backend base path. Relative so it works same-origin in production on Netlify.
// In dev, vite.config.js proxies this to the live backend (see VITE_BACKEND_TARGET).
export const API_BASE = '/.netlify/functions'