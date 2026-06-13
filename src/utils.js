export function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)  return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function etaLabel(mins) {
  if (mins === null || mins === undefined) return "—";
  if (mins <= 0) return "NOW";
  if (mins < 1)  return "< 1 min";
  return `~${Math.round(mins)} min`;
}

export function confidenceBadge(c) {
  if (c >= 0.85) return { label: "HIGH",   color: "#22c55e" };
  if (c >= 0.60) return { label: "MED",    color: "#f59e0b" };
  return           { label: "LOW",   color: "#6b7280" };
}

/**
 * Returns visual status tokens for a crossing given its detection + propagation state.
 */
export function crossingStatus(crossing, detections, propagated) {
  const det  = detections[crossing.id];
  const prop = propagated[crossing.id];

  if (crossing.hasCamera && det) {
    if (det.train_present && det.crossing_blocked) {
      return { label: "BLOCKED",  color: "#ef4444", bg: "#450a0a", border: "#ef4444", urgent: true };
    }
    if (det.train_present) {
      return { label: "TRAIN",    color: "#f97316", bg: "#2d1200", border: "#f97316", urgent: true };
    }
    if (det.confidence >= 0.55) {
      return { label: "CLEAR",    color: "#22c55e", bg: "#052e16", border: "#22c55e", urgent: false };
    }
    return   { label: "SCANNING", color: "#f59e0b", bg: "#1c1400", border: "#f59e0b", urgent: false };
  }

  if (prop) {
    // Eastbound train that already passed — crossing is clearing behind it
    if (prop.mode === "clearing") {
      return { label: "CLEARING", color: "#a78bfa", bg: "#1a1530", border: "#7c3aed", urgent: false };
    }
    // Approaching (westbound) — countdown
    if (prop.eta_mins <= 0) {
      return { label: "BLOCKED",              color: "#ef4444", bg: "#450a0a", border: "#ef4444", urgent: true };
    }
    if (prop.eta_mins < 3) {
      return { label: `ETA ${etaLabel(prop.eta_mins)}`, color: "#f97316", bg: "#2d1200", border: "#f97316", urgent: true };
    }
    if (prop.eta_mins < 8) {
      return { label: `ETA ${etaLabel(prop.eta_mins)}`, color: "#f59e0b", bg: "#1c1400", border: "#f59e0b", urgent: false };
    }
    return   { label: `ETA ${etaLabel(prop.eta_mins)}`, color: "#60a5fa", bg: "#0c1a2e", border: "#3b82f6", urgent: false };
  }

  return { label: crossing.hasCamera ? "OFFLINE" : "NO CAMERA",
           color: "#374151", bg: "#0d0d0d", border: "#1f2937", urgent: false };
}
