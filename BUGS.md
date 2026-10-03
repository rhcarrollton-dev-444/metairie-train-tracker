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

## Open

1. **The live camera image is never displayed.** `snapshotsRef` is write-only; the card and
   detail panel show only analysis text, never the actual snapshot. Promote `snapshotsRef` to
   state and render an `<img>` in `FeaturedCard.jsx` / `DetailPanel.jsx`. The base64 is
   already produced by `fetchSnapshotImage` in `src/lib/api.js` (currently discarded after
   analysis). **Highest user-visible value; frontend-only.**

2. **Each train detection wipes all propagated entries.** `runScan` does
   `setPropagated(propagatedNow)` (full replace), discarding server-propagated and
   community-propagated ETAs until the next 60s poll re-adds the server ones. Should merge
   instead of replace. (`src/App.jsx`)

3. **Community "All Clear" reports do nothing but log.** `submitReport` only acts on
   `train_present: true`; an all-clear never clears propagated entries nor fires
   `train_cleared`, unlike the scan-driven ALL CLEAR. (`src/App.jsx`)

4. **Downstream community reports fire no alert.** A report at a downstream crossing is
   logged but (since downstream crossings aren't in the corridor physics table) doesn't
   trigger a `train_detected` alert for that crossing, even though the crossing object
   exists in `DOWNSTREAM`. Could fire an alert without propagation. (`src/App.jsx`)

5. **`clearCounts` is not persisted.** Resets to 0 on reload, so 3 clears can fire ALL CLEAR
   even if the train was already gone before the reload. minor. (`src/App.jsx`)

6. **Server-propagation cleanup is keyed on Metairie globally.** When Metairie is clear, all
   `fromServer` propagated entries are wiped regardless of their own source. Should be
   per-source. (`src/App.jsx`)

7. **`anyUrgent` ignores downstream crossings.** The header stays green if a downstream watch
   camera shows a train. Likely intentional (corridor framing) but worth a decision.
   (`src/App.jsx`)

8. **`propagate()` confidence defaults to 0.8 (HIGH) when a detection has no confidence.** A
   propagated ETA from a no-confidence detection still shows ~HIGH-ish confidence. Probably
   unintended. (`src/lib/helpers.js`)

9. **Three different confidence thresholds coexist:** `.55` (CLEAR badge in `statusBadge`),
   `.6`/`.85` (MED/HIGH in `confidenceBadge`). Worth unifying or documenting.
   (`src/lib/helpers.js`)

## Notes / limitations (by design)

- The backend (Netlify functions) source is not recoverable; only the live endpoints + their
  contracts are known. Frontend changes that need new/changed backend behavior require
  reconstructing the functions separately (Anthropic + Resend keys).
- `snapshotsRef` stores `{url, fetchedAt}` per camera but nothing reads it (see open #1).
- The physics model is corridor-only (`distFromMetairie`); downstream crossings have no
  distance and can't be ETA-propagated.