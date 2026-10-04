# Known issues & backlog

Carried over from studying the original (minified) deployed app, plus fixes already applied
in this rebuild. Good starting points for "fix bugs / add features."

## Already fixed in this rebuild

- **Stale-closure ALL-CLEAR check.** The original read a `propagated` snapshot captured when
  the scan function was created, so the "fire `train_cleared` only if propagation exists"
  check used stale data. Now reads `propagatedRef.current`; `clearCounts` is a ref (it never
  drove UI), so it no longer needs a state round-trip.
- **Community report at a downstream crossing crashed.** The original called `propagate()`
  with an undefined crossing (downstream crossings aren't in the corridor table) and threw.
  Now guarded: downstream reports are logged without propagation.
- **Dead state in Watch Cameras.** The original declared an unused `useState`. Not reproduced.
- **PWA icons were missing on the live site** (404 -> Netlify SPA fallback returned
  `index.html` as the "PNG"). Real placeholder PNGs are now in `public/`. Replace with proper
  artwork when ready.
- **Physics propagation only handled crossings west of the source.** Now generalized to
  east-of-source for both directions, so community reports filed at any corridor crossing
  produce correct ETAs. Metairie-camera behavior is unchanged. (`src/lib/helpers.js`,
  `src/components/DetailPanel.jsx`)
- **Heatmap double-counted scans.** `combinedHistory` now dedups by
  `(crossingId, second-bucket, report-flag)` so a scan present in both server history and the
  local scanLog is counted once. (`src/App.jsx`)
- **Watch Cameras empty-state copy was misleading.** It implied the app's local scan
  populates the downstream cameras; they actually come from the server status poll.
  (`src/components/WatchCameras.jsx`)
- **Labarre (and any thin-history crossing) showed no probability numbers.** Corridor
  crossings with under 200 of their own scans now fall back to the merged corridor-camera
  history (same single track) until their own history is deep enough; UI flags the fallback.
  (`src/components/Heatmap.jsx`)
- **Train detection wiped all other propagated entries.** `runScan` did
  `setPropagated(propagatedNow)` (full replace). Now merges: only this source's own entries
  are replaced, server/community entries from other sources survive. (`src/App.jsx`)
- **Community "All Clear" reports did nothing but log.** Now clears propagated entries for
  that crossing and, if filed at a camera crossing, fires `train_cleared`. (`src/App.jsx`)
- **Downstream community reports fired no alert.** A report at a crossing with no
  `distFromMetairie` (can't propagate) now still fires that crossing's own `train_detected`
  alert. (`src/App.jsx`)
- **Server-propagation cleanup was keyed on Metairie globally.** Clearing Metairie wiped
  ALL server-propagated entries regardless of source. Now cleaned up per-source (Metairie,
  Labarre) so one camera going clear doesn't erase the other's live propagation.
  (`src/App.jsx`)
- **`propagate()` defaulted confidence to 0.8 (HIGH) when a detection had no confidence.**
  Now defaults to 0.5 (MED-low) so a low-information detection doesn't read as high-confidence.
  (`src/lib/helpers.js`)

## Open

1. **`clearCounts` is not persisted.** Resets to 0 on reload, so 3 clears can fire ALL CLEAR
   even if the train was already gone before the reload. minor. (`src/App.jsx`)

2. **`anyUrgent` ignores downstream crossings.** The header stays green if a downstream watch
   camera shows a train. Likely intentional (corridor framing) but worth a decision.
   (`src/App.jsx`)

3. **Three different confidence thresholds coexist:** `.55` (CLEAR badge in `statusBadge`),
   `.6`/`.85` (MED/HIGH in `confidenceBadge`). Worth unifying or documenting.
   (`src/lib/helpers.js`)

## Notes / limitations (by design)

- The backend (Netlify functions) source is not recoverable; only the live endpoints + their
  contracts are known. Frontend changes that need new/changed backend behavior require
  reconstructing the functions separately (Anthropic + Resend keys).
- `snapshotsRef` stores `{url, fetchedAt}` per camera but nothing reads it (see open #1).
- The physics model is corridor-only (`distFromMetairie`); downstream crossings have no
  distance and can't be ETA-propagated.