// Crossings ordered west → east along the NS Old Metairie corridor.
// distFromMetairie: signed miles relative to the Metairie Rd camera anchor.
// Negative = west of camera.

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

// Default assumed speed (mph) when Claude can't estimate from the image
export const DEFAULT_SPEED_MPH = 15;

// Minutes to travel one mile at a given speed
export const minsPerMile = (mph) => 60 / Math.max(mph, 1);
