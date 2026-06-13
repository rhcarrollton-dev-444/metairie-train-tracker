import { CROSSINGS, DEFAULT_SPEED_MPH, minsPerMile } from "./crossings.js";

/**
 * Given a detection result from a source crossing, compute ETAs
 * for all other crossings that the train is heading toward.
 *
 * Returns a map: crossingId → { eta_mins, direction, speed_mph, confidence, propagatedAt }
 */
export function propagate(detection, sourceCrossing) {
  if (
    !detection?.train_present ||
    !detection?.direction ||
    detection.direction === "none"
  ) {
    return {};
  }

  const speed = detection.speed_estimate_mph || DEFAULT_SPEED_MPH;
  const result = {};

  for (const c of CROSSINGS) {
    if (c.id === sourceCrossing.id) continue;

    const distFromSource = c.distFromMetairie - sourceCrossing.distFromMetairie;
    // Negative distFromSource → crossing is west of source
    // Positive distFromSource → crossing is east of source

    let eta_mins = null;

    if (detection.direction === "westbound" && distFromSource < 0) {
      eta_mins = minsPerMile(speed) * Math.abs(distFromSource);
    } else if (detection.direction === "eastbound" && distFromSource > 0) {
      eta_mins = minsPerMile(speed) * Math.abs(distFromSource);
    } else if (detection.direction === "stopped") {
      // Stopped train — flag crossings within half a mile as potentially blocked
      if (Math.abs(distFromSource) <= 0.5) {
        eta_mins = 0;
      }
    }

    if (eta_mins !== null) {
      result[c.id] = {
        eta_mins,
        direction: detection.direction,
        speed_mph: speed,
        // Propagated predictions carry slightly lower confidence
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.1),
        sourceId: sourceCrossing.id,
        sourceName: sourceCrossing.name,
        distMiles: Math.abs(distFromSource),
        propagatedAt: Date.now(),
      };
    }
  }

  return result;
}
