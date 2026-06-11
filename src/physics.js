/**
 * Physics-based ETA propagation
 * Given a detection at Metairie Rd, calculate arrival time at each crossing
 */

const DEFAULT_SPEED_MPH = 15

/**
 * Calculate ETAs for all crossings based on detection at camera crossing
 * @param {string} direction - 'westbound' | 'eastbound'
 * @param {number|null} speedMph - detected speed, or null to use default
 * @param {Date} detectedAt - when the train was detected
 * @param {Array} crossings - crossing definitions
 * @returns {Object} map of crossingId -> { etaDate, minutesAway, distanceMiles }
 */
export function propagateETAs(direction, speedMph, detectedAt, crossings) {
  const speed = speedMph || DEFAULT_SPEED_MPH
  const etas = {}

  for (const crossing of crossings) {
    if (crossing.distanceFromMetairieRd === 0) {
      // Camera crossing — already here
      etas[crossing.id] = {
        etaDate: detectedAt,
        minutesAway: 0,
        distanceMiles: 0,
        status: 'ACTIVE',
      }
      continue
    }

    if (direction === 'westbound') {
      // Train moving west — will hit farnham, hollywood, atherton, labarre in sequence
      const travelTimeMin = (crossing.distanceFromMetairieRd / speed) * 60
      const etaDate = new Date(detectedAt.getTime() + travelTimeMin * 60 * 1000)
      etas[crossing.id] = {
        etaDate,
        minutesAway: travelTimeMin,
        distanceMiles: crossing.distanceFromMetairieRd,
        status: 'INCOMING',
      }
    } else {
      // Eastbound — train already passed these crossings (came from west)
      const travelTimeMin = (crossing.distanceFromMetairieRd / speed) * 60
      const passedAt = new Date(detectedAt.getTime() - travelTimeMin * 60 * 1000)
      etas[crossing.id] = {
        etaDate: passedAt,
        minutesAway: -travelTimeMin,
        distanceMiles: crossing.distanceFromMetairieRd,
        status: 'PASSED',
      }
    }
  }

  return etas
}

export function formatETA(eta) {
  if (!eta) return null
  if (eta.minutesAway === 0) return 'Here now'
  if (eta.minutesAway < 0) return `Passed ~${Math.abs(Math.round(eta.minutesAway))}m ago`
  if (eta.minutesAway < 1) return 'Arriving now'
  return `~${Math.round(eta.minutesAway)} min away`
}
