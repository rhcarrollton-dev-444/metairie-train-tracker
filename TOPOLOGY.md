# Corridor topology & connectivity findings

Researched 2026-10-02 from OpenStreetMap rail data (Overpass), the JP parish camera
page, and direct probing of the live camera + backend pipeline.

## The blocker: it is not the camera

The Metairie Rd camera is **live and healthy**. Verified:

- Frames are served fresh: cache-busted fetches advance on roughly a 60s cycle
  (`Last-Modified` tracks current time; `Cache-Control: no-cache, no-store`).
- The HLS stream is advancing (`EXT-X-MEDIA-SEQUENCE` increments continuously).
- The burned-in overlay matches wall-clock time to the second.
- `snapshot-url` and `snapshot-image` both return valid 66 KB JPEGs for all 8 aliases.

What is actually broken: **the Anthropic API credit balance is exhausted.**

```
POST /.netlify/functions/analyze-vision
HTTP 400
{"error":"Your credit balance is too low to access the Anthropic API.
          Please go to Plans & Billing to upgrade or purchase credits."}
```

Every scan fails at the vision step, so no detection is produced, so the UI has
nothing to show. Fix billing on the Netlify function's Anthropic key and detection
resumes with no code change. `status` still reports `online: true` because that
field only reflects the camera, not the analysis.

## The corridor is ONE line, not two

All five Old Metairie crossings sit on a single Norfolk Southern line — the
**Back Belt Line** (the NS Bernadotte Line). Verified as a stitched, connected
polyline from Metairie Rd west to the junction: **2.307 miles**.

| crossing | app `distFromMetairie` | measured track miles | delta |
|---|---|---|---|
| Metairie Rd | 0.00 | 0.000 | — |
| Farnham Pl | 0.18 | 0.307 | +71% |
| Hollywood Dr | 0.42 | 0.821 | +95% |
| Atherton Dr | 0.72 | 1.065 | +48% |
| Labarre Rd | 1.05 | 1.462 | +39% |

**The app's distance table understates every distance, Hollywood by nearly 2x.**
Since ETA = `minutesPerMile(speed) * distance`, propagated ETAs fire roughly twice
as early as they should for the middle of the corridor. Correcting
`distFromMetairie` in `src/data/crossings.js` is a one-line-per-crossing fix with
direct accuracy impact.

## Where the corridors connect: Labarre Rd junction

There is a **true junction** at `29.97075, -90.16399`, 2.307 track-miles west of
Metairie Rd. The graph node there is degree 3, with both lines incident:

```
(29.97075,-90.16399)
   -> (29.97077,-90.16419)   64 ft   CN McComb Subdivision
   -> (29.97018,-90.15517) 2795 ft   CN McComb Subdivision
   -> (29.97075,-90.16375)   76 ft   Back Belt Line (NS)
```

So the **Norfolk Southern Back Belt** and the **CN McComb Subdivision** physically
join just west of Labarre Rd. This is the missing link for prediction: a train
westbound past Labarre Rd does not vanish, it continues onto CN track and can then
block the whole western chain.

## What that unlocks

Crossings reachable by following the connected route from the Metairie Rd camera:

**Old Metairie corridor (NS Back Belt)**
Metairie Rd 0.000 · Farnham 0.307 · Hollywood 0.821 · Atherton 1.065 · Labarre 1.462

**Western chain (via the Labarre junction, CN McComb Subdivision)**
Shrewsbury Rd · Central Ave · Newman Ave · Little Farms Ave · Filmore St · George St
and on toward the Kenner crossings.

This means a westbound train detected at Metairie Rd can be propagated all the way
down the western chain, not just to Labarre. That is a large extension of the
prediction surface, and the physics in `propagate()` already generalizes to it —
it just needs the real distances.

## Not connected (separate corridor)

A distinct corridor runs further west: **UP Livonia Subdivision / Avondale
Subdivision**, carrying **Live Oak Blvd, Willswood Ln, Avondale Garden Rd**
(Waggaman / Avondale). It does not join the Old Metairie corridor near the
corridor; treat these as an independent prediction group, not downstream of
Metairie Rd.

## Cameras the app does not know about

The JP parish rail camera page publishes **14** aliases. The app uses 8. Missing:

| crossing | alias | status |
|---|---|---|
| **Labarre Road** | `6aaae2ff5b5bc` | **LIVE** (frames advance) |
| Taylor Street | `6aaacf1f0f0dc` | frozen — identical hash across 12s, night frame at 10:31 AM. Likely offline/stuck |
| Central Avenue #1 | `6aaae63d530e6` | live |
| Central Avenue #2 | `6aaae68b225d8` | live |
| Jefferson Hwy Eastbound | `6aaae498d22ac` | live |
| Jefferson Hwy Westbound | `6aaae59f77ffa` | live |

The app currently marks Labarre Rd as `hasCamera: false`. It has a camera, and
adding it gives the corridor a **second real observation point** — which is the
single biggest structural improvement available for prediction, because you stop
inferring the whole west end from one camera.

Full verified alias map:

| crossing | alias |
|---|---|
| Avondale Garden Rd | `635c0abb11126` |
| Central Ave #1 | `6aaae63d530e6` |
| Central Ave #2 | `6aaae68b225d8` |
| Central Ave #3 (app "Central Ave") | `63609c3400e64` |
| Filmore St | `6529556348194` |
| George St | `635c0c64414c1` |
| Jefferson Hwy Eastbound | `6aaae498d22ac` |
| Jefferson Hwy Westbound | `6aaae59f77ffa` |
| Labarre Rd | `6aaae2ff5b5bc` |
| Little Farms Ave | `62b47da483e1f` |
| Live Oak Blvd | `635c1059a967e` |
| Metairie Rd | `62fa4c1fb9f5c` |
| Taylor St | `6aaacf1f0f0dc` |
| Willswood Ln | `635c112681056` |

## Confidence notes

High confidence: the junction, the NS Back Belt membership of the five Old Metairie
crossings, measured distances Metairie→Labarre, the credit-balance failure, the
camera-6 live status, and the Labarre camera alias.

Lower confidence: exact track mileage from the junction west to Filmore/George.
The CN line curves back east after Central Ave, so arc-length numbers for the far
western crossings are sensitive to how parallel ways are stitched. Distances for
those should be re-derived from a stitched CN polyline before being hardcoded.

## Suggested next steps

1. ~~Top up Anthropic credits (unblocks everything; no code change).~~  
   **DONE 2026-10-02**: Credits restored, analyze-vision returns HTTP 200.

2. ~~Correct `distFromMetairie` for the five corridor crossings.~~  
   **DONE 2026-10-02**: All distances corrected to OSM-measured track miles:
   - Farnham: 0.18 → 0.307 mi (+71%)
   - Hollywood: 0.42 → 0.821 mi (+95%)
   - Atherton: 0.72 → 1.065 mi (+48%)
   - Labarre: 1.05 → 1.462 mi (+39%)

3. ~~Add the Labarre Rd camera as a second corridor observation point.~~  
   **DONE 2026-10-02**: Labarre now `hasCamera: true`, `alias: '6aaae2ff5b5bc'`.  
   App now has two live cameras on the Old Metairie corridor.

4. ~~Add the junction as a route edge so westbound trains propagate onto CN.~~  
   **DONE 2026-10-02**: `propagate()` extended to follow westbound trains through  
   the Labarre junction onto CN McComb (Little Farms, Central, Filmore, George).  
   Eastbound trains stay on NS Back Belt. UI shows a dedicated "WESTERN CHAIN (CN)"  
   section when predictions are active. Community reports now work for DOWNSTREAM  
   crossings with `distFromMetairie`.

5. Rebuild from a stitched CN polyline before hardcoding western distances.  
   **PARTIAL**: CN crossings use estimated distances (flagged `[OSM_REFINEMENT_NEEDED]`  
   in `src/data/crossings.js`). Current estimates based on typical metro spacing:
   - Little Farms: 3.5 mi
   - Central Ave: 4.8 mi
   - Filmore St: 5.5 mi
   - George St: 5.9 mi
   
   When OSM Overpass is accessible, re-measure from a stitched CN McComb polyline  
   starting at junction (29.97075, -90.16399) and replace the estimates.
