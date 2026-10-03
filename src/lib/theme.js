// Centralized palette + shared inline-style fragments. The deployed app styles
// everything with inline `style` objects; we keep that approach (no CSS framework)
// but pull the magic values here so they're easy to tweak.

export const color = {
  // app / panel backgrounds
  appBg: '#080b10',
  panelBg: '#0d1420',
  nestedBg: '#0a1018',
  tabBg: '#0a0e16',
  headerGradTop: '#0f172a',
  downstreamIdle: '#0b111c',
  watchTrainBg: '#1a0d0d',
  disabled: '#1a2535',
  errorBox: '#2d0a0a',

  // borders
  border: '#1e2d45',
  borderMuted: '#334155',
  divider: '#1a2435',
  blueActive: '#3b82f6',
  blueActiveBg: '#1e3a5f',
  purpleBorder: '#7c3aed',

  // buttons
  primaryBtn: '#1d4ed8',

  // text
  heading: '#f1f5f9',
  body: '#94a3b8',
  inputText: '#e2e8f0',
  muted: '#475569',
  dim: '#334155',
  veryDim: '#3a4a63',
  footer: '#283548',
  green: '#22c55e',
  greenText: '#86efac',
  red: '#ef4444',
  redText: '#fca5a5',
  orange: '#f97316',
  orangeText: '#fdba74',
  amber: '#f59e0b',
  amberText: '#fbbf24',
  blueText: '#93c5fd',
  blueAccent: '#60a5fa',
  purpleText: '#c4b5fd',
  purpleSoft: '#a78bfa',
}

// Common card / surface styles.
export const surface = {
  panel: { background: color.panelBg, border: `1px solid ${color.border}`, borderRadius: 10 },
  input: {
    background: color.panelBg,
    border: `1px solid ${color.border}`,
    color: color.inputText,
    borderRadius: 6,
  },
}

export const TOAST_LIFE_MS = 4000
export const STATUS_POLL_MS = 60000