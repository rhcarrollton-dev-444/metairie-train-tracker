# Metairie Rail Tracker

Live train detection for the Old Metairie corridor (Norfolk Southern line). A React PWA
that grabs snapshots from a live JP camera at Metairie Rd, sends them to Claude Sonnet
Vision for analysis, and propagates physics-based ETAs to the corridor crossings without
cameras.

## Stack

- React 18 + Vite 5 (plain inline styles, no CSS framework)
- Backend: Netlify serverless functions (`/.netlify/functions/*`) — **not in this repo**;
  the dev server proxies to the live deployed backend by default.
- PWA (manifest + icons)

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

> If `npm install` fails with `EACCES` in `~/.npm`, your npm cache has root-owned files
> (from past `sudo`). Use a fresh cache: `npm install --cache /tmp/npm-cache-mrt`.

### Backend / API

The app calls its backend at the relative path `/.netlify/functions`. In production on
Netlify that's same-origin. In dev, Vite proxies that path to a real backend so there are
no CORS issues. It defaults to the **live** deployed backend:

```
https://fascinating-platypus-46f604.netlify.app/.netlify/functions
```

To point at your own backend (e.g. after you deploy your own functions):

```bash
VITE_BACKEND_TARGET=https://your-site.netlify.app npm run dev
```

Endpoints (see `src/lib/api.js`):

| Path | Method | Purpose |
|---|---|---|
| `/status?history=1` | GET | Current corridor status + history |
| `/snapshot-url?alias=` | GET | Resolve a JP ipcamlive alias to a snapshot URL |
| `/snapshot-image?url=` | GET | Fetch snapshot bytes (base64), server-side |
| `/analyze-vision` | POST | Claude Vision analysis (base64 image -> detection) |
| `/send-alert` | POST | Email alert (Resend); 30-min cooldown server-side |

> ⚠️ The **source for the Netlify functions is not in this repo** — only the live endpoints
> and their request contracts are known. To edit backend behavior you'll need to
> reconstruct/deploy your own functions (Anthropic API key for Claude Vision,
> `RESEND_API_KEY` for email).

## Scripts

```bash
npm run dev      # vite dev server
npm run build    # production build -> dist/
npm run preview  # serve the built dist/
npm run lint     # eslint
```

## Project layout

```
src/
  main.jsx                 # entry
  App.jsx                  # root: state, scan loop, server polling, alerts
  index.css                # global resets + keyframes (matches deployed app)
  data/
    crossings.js           # CORRIDOR + DOWNSTREAM crossings, constants
  lib/
    api.js                 # fetch wrappers for the 5 backend endpoints
    helpers.js             # propagate(), statusBadge(), formatEta(), localStorage, ...
    theme.js               # palette + shared style fragments
  components/
    Header.jsx             Tabs.jsx
    CorridorView.jsx       FeaturedCard.jsx   DownstreamCard.jsx   DetailPanel.jsx
    WatchCameras.jsx       ManualScanPanel.jsx ReportModal.jsx
    Heatmap.jsx            HeatmapStat.jsx     Log.jsx   About.jsx
    Dot.jsx                StatTile.jsx        Toasts.jsx           AboutCard.jsx
```

See `BUGS.md` for known issues and improvement ideas.