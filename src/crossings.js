// ─────────────────────────────────────────────────────────────────────────────
// Two kinds of locations:
//
//  CORRIDOR crossings — the five Old Metairie crossings we actively predict for.
//    Metairie Rd has the camera; the other four are predicted via physics from it.
//    distFromMetairie drives ETA math (negative = west of Metairie Rd camera).
//
//  WATCH cameras — other Jefferson Parish rail cameras we SCAN for data collection
//    only. We don't assume how they connect to the corridor; instead we log every
//    timestamped detection so the cross-camera timing patterns can be MEASURED from
//    real data over time (e.g. "does Metairie Rd westbound reliably precede Little
//    Farms by ~25 min?"). No assumed ETAs between them yet.
// ─────────────────────────────────────────────────────────────────────────────

export const CROSSINGS = [
  {
    id: "labarre",
    name: "Labarre Rd",
    short: "Labarre",
    address: "N Labarre Rd",
    dot: "725708R",
    distFromMetairie: -1.05,
    hasCamera: false,
    alias: null,
  },
  {
    id: "atherton",
    name: "Atherton Dr",
    short: "Atherton",
    address: "Atherton Dr",
    dot: "725709X",
    distFromMetairie: -0.72,
    hasCamera: false,
    alias: null,
  },
  {
    id: "hollywood",
    name: "Hollywood Dr",
    short: "Hollywood",
    address: "Hollywood Dr",
    dot: "725710S",
    distFromMetairie: -0.42,
    hasCamera: false,
    alias: null,
  },
  {
    id: "farnham",
    name: "Farnham Pl",
    short: "Farnham",
    address: "Farnham Pl",
    dot: "725711Y",
    distFromMetairie: -0.18,
    hasCamera: false,
    alias: null,
  },
  {
    id: "metairie",
    name: "Metairie Rd",
    short: "Metairie Rd",
    address: "Metairie Rd / Frisco Ave",
    dot: "725712F",
    distFromMetairie: 0,
    hasCamera: true,
    alias: "62fa4c1fb9f5c",
  },
];

// Jefferson Parish cameras we scan purely to collect detection data.
// Order here is just the JP listing order — NOT a confirmed geographic sequence.
export const WATCH_CAMERAS = [
  { id: "littlefarms", name: "Little Farms Ave",   short: "Little Farms", alias: "62b47da483e1f", area: "River Ridge" },
  { id: "central",     name: "Central Ave",        short: "Central",      alias: "63609c3400e64", area: "West Bank" },
  { id: "avondale",    name: "Avondale Garden Rd", short: "Avondale",     alias: "635c0abb11126", area: "Avondale" },
  { id: "filmore",     name: "Filmore St",         short: "Filmore",      alias: "6529556348194", area: "Jefferson" },
  { id: "george",      name: "George St",          short: "George",       alias: "635c0c64414c1", area: "Jefferson" },
  { id: "liveoak",     name: "Live Oak Blvd",      short: "Live Oak",     alias: "635c1059a967e", area: "Waggaman" },
  { id: "willswood",   name: "Willswood Ln",       short: "Willswood",    alias: "635c112681056", area: "Waggaman" },
];

// All aliases we scan each cycle (corridor camera + watch cameras)
export const SCAN_TARGETS = [
  ...CROSSINGS.filter(c => c.hasCamera).map(c => ({ id: c.id, name: c.name, alias: c.alias })),
  ...WATCH_CAMERAS.map(w => ({ id: w.id, name: w.name, alias: w.alias })),
];

// Default assumed speed (mph) when Claude can't estimate from the image
export const DEFAULT_SPEED_MPH = 15;

// Minutes to travel one mile at a given speed
export const minsPerMile = (mph) => 60 / Math.max(mph, 1);
