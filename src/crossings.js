// Corridor crossings — west to east order
// Cameras only exist at Metairie Rd (the easternmost) via ipcamlive
export const CROSSINGS = [
  {
    id: 'labarre',
    name: 'Labarre Road',
    dot: '725708R',
    address: 'N Labarre Rd',
    cameraAlias: null,
    distanceFromMetairieRd: 1.05, // miles west
  },
  {
    id: 'atherton',
    name: 'Atherton Drive',
    dot: '725709X',
    address: 'Atherton Dr',
    cameraAlias: null,
    distanceFromMetairieRd: 0.72,
  },
  {
    id: 'hollywood',
    name: 'Hollywood Drive',
    dot: '725710S',
    address: 'Hollywood Dr',
    cameraAlias: null,
    distanceFromMetairieRd: 0.42,
  },
  {
    id: 'farnham',
    name: 'Farnham Place',
    dot: '725711Y',
    address: 'Farnham Pl',
    cameraAlias: null,
    distanceFromMetairieRd: 0.18,
  },
  {
    id: 'frisco',
    name: 'Frisco Road (Metairie Rd)',
    dot: '725712F',
    address: 'Frisco Ave & Metairie Rd',
    cameraAlias: '62fa4c1fb9f5c', // ipcamlive alias
    distanceFromMetairieRd: 0,
  },
]

export const CAMERA_CROSSING_ID = 'frisco'
