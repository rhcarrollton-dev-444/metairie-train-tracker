import { CROSSINGS, DEFAULT_SPEED_MPH, minsPerMile } from "./crossings.js";

/**
 * Given a detection at the camera crossing (Metairie Rd), compute the state of
 * every other crossing based on the train's direction.
 *
 * Corridor geometry (west → east):
 *   Labarre → Atherton → Hollywood → Farnham → Metairie Rd (camera)
 * All no-camera crossings sit WEST of Metairie Rd (distFromMetairie < 0).
 *
 * Direction meaning (matches how trains actually move through the corridor):
 *   - "westbound": moving west, AWAY from New Orleans. Hits Metairie Rd first,
 *       then heads toward Farnham → Hollywood → Atherton → Labarre.
 *       → these crossings get real forward ETAs.
 *   - "eastbound": moving east, TOWARD New Orleans / Metairie Rd. It has ALREADY
 *       passed the western crossings before reaching the camera, so we can't give
 *       a forward ETA — they're clearing behind it (tail may still occupy them).
 *       → mark as "clearing" rather than a countdown.
 *   - "stopped": train is sitting on the camera crossing. We can't know which way
 *       it'll resume, so we don't predict the others.
 *
 * Returns a map: crossingId → propagation object.
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

  // Stopped train: only the camera crossing itself is blocked. Don't predict others.
  if (detection.direction === "stopped") {
    return {};
  }

  for (const c of CROSSINGS) {
    if (c.id === sourceCrossing.id) continue;

    const distFromSource = c.distFromMetairie - sourceCrossing.distFromMetairie;
    // For our corridor, every no-camera crossing is west of Metairie Rd,
    // so distFromSource is negative for all of them.
    const isWestOfCamera = distFromSource < 0;

    if (detection.direction === "westbound" && isWestOfCamera) {
      // Train heading toward this crossing — real forward ETA.
      const eta_mins = minsPerMile(speed) * Math.abs(distFromSource);
      result[c.id] = {
        mode: "approaching",
        eta_mins,
        direction: detection.direction,
        speed_mph: speed,
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.1),
        sourceId: sourceCrossing.id,
        sourceName: sourceCrossing.name,
        distMiles: Math.abs(distFromSource),
        propagatedAt: Date.now(),
      };
    } else if (detection.direction === "eastbound" && isWestOfCamera) {
      // Train already passed this crossing on its way to the camera.
      // It's clearing behind the train (or still occupied by a long tail).
      result[c.id] = {
        mode: "clearing",
        eta_mins: null,
        direction: detection.direction,
        speed_mph: speed,
        confidence: Math.max(0, (detection.confidence ?? 0.8) - 0.2),
        sourceId: sourceCrossing.id,
        sourceName: sourceCrossing.name,
        distMiles: Math.abs(distFromSource),
        propagatedAt: Date.now(),
      };
    }
  }

  return result;
}
