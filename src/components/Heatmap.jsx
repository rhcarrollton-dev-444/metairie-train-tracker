import { useCallback, useMemo, useState } from 'react'
import { CORRIDOR, DOWNSTREAM } from '../data/crossings'
import HeatmapStat from './HeatmapStat'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

// American 12-hour label: 0 -> 12a, 6 -> 6a, 12 -> 12p, 18 -> 6p
function hour12(h) {
  const ampm = h < 12 ? 'a' : 'p'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

function cellColor(cell, maxRatio) {
  if (cell.total === 0) return '#0d1420'
  const ratio = cell.trains / cell.total
  if (ratio === 0) return '#052e16'
  const x = ratio / maxRatio
  const r = Math.round(239 * x)
  const g = Math.round(68 + 112 * (1 - x))
  const b = Math.round(68 * (1 - x) + 20)
  return `rgb(${r},${g},${b})`
}

function probColor(prob) {
  if (prob == null) return { bg: '#0c1a2e', border: '#3b82f644', color: '#93c5fd' }
  if (prob >= 0.4) return { bg: '#450a0a', border: '#ef4444', color: '#fca5a5' }
  if (prob >= 0.15) return { bg: '#2d1200', border: '#f97316', color: '#fdba74' }
  return { bg: '#052e16', border: '#22c55e', color: '#86efac' }
}

// Heatmap tab (`Rp`): right-now probability, stats, 7x24 grid, hourly bars.
export default function Heatmap({ history }) {
  const [filterId, setFilterId] = useState('all')

  // Camera-less corridor crossings (Farnham/Hollywood/Atherton) sit on the same
  // single track between the Metairie and Labarre cameras — every train seen at
  // either camera rolls through them. They have no scan history of their own, so
  // their stats are INFERRED from the corridor cameras' combined history.
  // The same fallback covers a corridor CAMERA whose own history is still thin
  // (e.g. Labarre, added to the scan cron much later than Metairie).
  const THIN_SCANS = 200
  const CORRIDOR_CAM_IDS = useMemo(
    () => new Set(CORRIDOR.filter((c) => c.hasCamera).map((c) => c.id)),
    []
  )
  const CORRIDOR_IDS = useMemo(() => new Set(CORRIDOR.map((c) => c.id)), [])
  const INFERRED_IDS = useMemo(
    () => new Set(CORRIDOR.filter((c) => !c.hasCamera).map((c) => c.id)),
    []
  )

  // Scan counts per crossing (to detect thin camera history)
  const scanCounts = useMemo(() => {
    const m = {}
    for (const r of history) if (r.crossingId) m[r.crossingId] = (m[r.crossingId] || 0) + 1
    return m
  }, [history])

  // A corridor crossing uses merged corridor-camera history when it has no camera
  // OR its own history is still too thin to be meaningful.
  const usesCorridorHistory = useCallback(
    (id) => CORRIDOR_IDS.has(id) && (INFERRED_IDS.has(id) || (scanCounts[id] || 0) < THIN_SCANS),
    [CORRIDOR_IDS, INFERRED_IDS, scanCounts]
  )

  const filtered = useMemo(() => {
    if (filterId === 'all') return history
    // Corridor crossing without enough own data: show the corridor cameras' records
    if (usesCorridorHistory(filterId)) return history.filter((r) => CORRIDOR_CAM_IDS.has(r.crossingId))
    return history.filter((r) => r.crossingId === filterId)
  }, [history, filterId, usesCorridorHistory, CORRIDOR_CAM_IDS])

  const grid = useMemo(() => {
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ total: 0, trains: 0 })))
    for (const r of filtered) {
      if (!r.ts) continue
      const d = new Date(r.ts)
      cells[d.getDay()][d.getHours()].total++
      if (r.train_present) cells[d.getDay()][d.getHours()].trains++
    }
    return cells
  }, [filtered])

  const maxRatio = useMemo(() => {
    let m = 0
    for (const row of grid) for (const c of row) if (c.total > 0) m = Math.max(m, c.trains / c.total)
    return m || 1
  }, [grid])

  const total = filtered.length
  const trains = filtered.filter((r) => r.train_present).length
  const rate = total > 0 ? ((trains / total) * 100).toFixed(1) : '—'

  // "Right now": aggregate the 3 hours centered on the current hour, for this
  // weekday and across all weekdays.
  const now = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    const hour = d.getHours()
    const win = [(hour + 23) % 24, hour, (hour + 1) % 24]
    let dayTotal = 0,
      dayTrains = 0,
      allTotal = 0,
      allTrains = 0
    for (const h of win) {
      dayTotal += grid[day][h].total
      dayTrains += grid[day][h].trains
      for (const row of grid) {
        allTotal += row[h].total
        allTrains += row[h].trains
      }
    }
    return {
      hour,
      dayProb: dayTotal > 0 ? dayTrains / dayTotal : null,
      allProb: allTotal > 0 ? allTrains / allTotal : null,
      dayTotal,
      allTotal,
    }
  }, [grid])

  const hourly = useMemo(() => {
    const out = []
    for (const h of HOURS) {
      let t = 0,
        tr = 0
      for (const row of grid) {
        t += row[h].total
        tr += row[h].trains
      }
      out.push({ h, total: t, prob: t > 0 ? tr / t : 0 })
    }
    return out
  }, [grid])

  const peak = useMemo(() => {
    let best = { h: null, prob: 0 }
    for (const x of hourly) if (x.total >= 3 && x.prob > best.prob) best = x
    return best.h != null ? best : null
  }, [hourly])

  // Per-crossing probability: for EVERY crossing with scan data (corridor cameras
  // + all watch cameras), compute the right-now probability (same ±1hr window,
  // this weekday, falling back to all days) plus the overall train rate.
  // Uses the FULL history, not the filtered view, so the panel is stable.
  const ALL_CROSSINGS = useMemo(
    () => [
      ...CORRIDOR.map((c) => ({ id: c.id, short: c.short, area: 'Old Metairie' })),
      ...DOWNSTREAM.map((c) => ({ id: c.id, short: c.short, area: c.area })),
    ],
    []
  )

  const perCrossing = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    const win = [(d.getHours() + 23) % 24, d.getHours(), (d.getHours() + 1) % 24]
    const winSet = new Set(win)

    // one pass over full history, bucketed per crossing
    const buckets = {}
    const mkBucket = () => ({ total: 0, trains: 0, nowDayT: 0, nowDayTr: 0, nowAllT: 0, nowAllTr: 0 })
    const add = (b, r, rd) => {
      b.total++
      if (r.train_present) b.trains++
      if (winSet.has(rd.getHours())) {
        b.nowAllT++
        if (r.train_present) b.nowAllTr++
        if (rd.getDay() === day) {
          b.nowDayT++
          if (r.train_present) b.nowDayTr++
        }
      }
    }
    const corridorBucket = mkBucket() // merged corridor-camera history for inference
    for (const r of history) {
      if (!r.ts || !r.crossingId) continue
      const rd = new Date(r.ts)
      let b = buckets[r.crossingId]
      if (!b) b = buckets[r.crossingId] = mkBucket()
      add(b, r, rd)
      if (CORRIDOR_CAM_IDS.has(r.crossingId)) add(corridorBucket, r, rd)
    }

    const statsFrom = (b) => {
      if (!b || b.total === 0) return { prob: null, rate: null, n: 0 }
      const prob =
        b.nowDayT >= 5 ? b.nowDayTr / b.nowDayT
        : b.nowAllT >= 5 ? b.nowAllTr / b.nowAllT
        : b.trains / b.total
      return { prob, rate: b.trains / b.total, n: b.total }
    }

    return ALL_CROSSINGS.map((c) => {
      // Corridor crossings without a camera (or with thin camera history) inherit
      // the merged corridor-camera stats
      if (usesCorridorHistory(c.id)) {
        const own = statsFrom(buckets[c.id])
        return { ...c, ...statsFrom(corridorBucket), ownN: own.n, inferred: true }
      }
      return { ...c, ...statsFrom(buckets[c.id]) }
    })
  }, [history, ALL_CROSSINGS, CORRIDOR_CAM_IDS, usesCorridorHistory])

  const filters = [{ id: 'all', name: 'All Crossings' }, ...CORRIDOR, ...DOWNSTREAM]
  const prob = now.dayProb ?? now.allProb
  const pc = probColor(prob)
  const plural = (n) => (n === 1 ? '' : 's')

  return (
    <div style={{ padding: 14 }}>
      {/* Right now */}
      <div style={{ background: pc.bg, border: `1px solid ${pc.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: pc.color, letterSpacing: 0.6, fontWeight: 700 }}>
          RIGHT NOW · {now.hour}:00–{(now.hour + 1) % 24}:00{' '}
          {now.dayProb == null && now.allProb != null ? '(all days)' : '(this weekday)'}
        </div>
        {prob == null ? (
          <div style={{ fontSize: 14, color: pc.color, marginTop: 6 }}>Not enough data yet for this time</div>
        ) : (
          <>
            <div style={{ fontSize: 26, fontWeight: 800, color: pc.color, marginTop: 4 }}>
              {Math.round(prob * 100)}% chance of a train
            </div>
            <div style={{ fontSize: 12, color: pc.color, marginTop: 4 }}>
              {prob >= 0.4
                ? '⚠ High — consider an alternate route'
                : prob >= 0.15
                ? 'Moderate — check the live status above before leaving'
                : '✓ Low — usually clear at this time'}
            </div>
            <div style={{ fontSize: 10, color: pc.color, opacity: 0.7, marginTop: 6 }}>
              Based on {(now.dayProb != null ? now.dayTotal : now.allTotal)} past check
              {plural(now.dayProb != null ? now.dayTotal : now.allTotal)} around this hour
            </div>
          </>
        )}
      </div>

      {/* Per-crossing probability — every crossing with scan data */}
      <div style={{ background: '#0d1420', border: '1px solid #1e2d45', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#93c5fd', letterSpacing: 0.8, fontWeight: 700, marginBottom: 8 }}>
          TRAIN PROBABILITY BY CROSSING · RIGHT NOW
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
          {perCrossing.map((c) => {
            const cpc = probColor(c.prob)
            return (
              <div
                key={c.id}
                onClick={() => setFilterId(filterId === c.id ? 'all' : c.id)}
                style={{
                  background: cpc.bg,
                  border: `1px solid ${filterId === c.id ? '#3b82f6' : cpc.border}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>{c.short}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: cpc.color }}>
                    {c.prob == null ? '—' : `${Math.round(c.prob * 100)}%`}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                  {c.area}
                  {c.n > 0 && ` · ${Math.round(c.rate * 100)}% overall · ${c.n} scans`}
                  {c.n > 0 && c.inferred && (c.ownN > 0 ? ` · corridor data (own: ${c.ownN})` : ' · from corridor cams')}
                  {c.n === 0 && ' · no data yet'}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 9, color: '#283548', marginTop: 8 }}>
          Right-now = this time of day (±1 hr). Tap a crossing to filter the grid below to it.
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <HeatmapStat label="Total Scans" value={total} color="#60a5fa" />
        <HeatmapStat label="Train Sightings" value={trains} color="#f97316" />
        <HeatmapStat label="Train Rate" value={`${rate}%`} color="#f59e0b" />
      </div>

      {peak && (
        <div style={{ background: '#1c1400', border: '1px solid #f59e0b44', borderRadius: 8, padding: '8px 12px', marginBottom: 12, color: '#fbbf24', fontSize: 12 }}>
          🔥 Peak hour: {peak.h}:00–{peak.h + 1}:00 ({Math.round(peak.prob * 100)}% train probability)
        </div>
      )}

      {total < 10 && (
        <div style={{ background: '#0c1a2e', border: '1px solid #3b82f644', borderRadius: 8, padding: '8px 12px', marginBottom: 12, color: '#93c5fd', fontSize: 12 }}>
          ℹ Run more scans to build a meaningful heatmap. Showing {total} data point{plural(total)}.
        </div>
      )}

      {/* Crossing filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {filters.map((f) => {
          const active = filterId === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilterId(f.id)}
              style={{
                background: active ? '#1e3a5f' : '#0a1018',
                border: `1px solid ${active ? '#3b82f6' : '#1e2d45'}`,
                color: active ? '#60a5fa' : '#f1f5f9',
                fontWeight: 700,
                borderRadius: 7,
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {f.short || f.name}
            </button>
          )
        })}
      </div>

      {/* Heatmap grid */}
      <div style={{ background: '#0d1420', border: '1px solid #1e2d45', borderRadius: 10, padding: 12, overflowX: 'auto', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#93c5fd', letterSpacing: 0.8, fontWeight: 700, marginBottom: 8 }}>
          TRAIN PROBABILITY BY HOUR & DAY OF WEEK
        </div>
        {usesCorridorHistory(filterId) && (
          <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 8 }}>
            {INFERRED_IDS.has(filterId)
              ? 'No camera at this crossing — showing the corridor cameras\u2019 history. Same track, so every train they see passes here too.'
              : 'This camera\u2019s own history is still building — showing the combined corridor history (same track) until it has enough scans.'}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '42px repeat(24,1fr)', gap: 2, minWidth: 600 }}>
          <div />
          {HOURS.map((h) => (
            <div key={h} style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9', textAlign: 'center' }}>
              {h % 3 === 0 ? hour12(h) : ''}
            </div>
          ))}
          {grid.map((row, day) => (
            <Row key={day} day={day} row={row} maxRatio={maxRatio} />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: '#64748b' }}>Low</span>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => (
          <span key={p} style={{ width: 14, height: 12, borderRadius: 2, background: cellColor({ trains: p, total: 1 }, 1) }} />
        ))}
        <span style={{ fontSize: 9, color: '#64748b' }}>High</span>
        <span style={{ fontSize: 9, color: '#64748b', marginLeft: 8 }}>Gray = no data</span>
      </div>

      {/* Hourly bars */}
      {total >= 5 && (
        <div style={{ background: '#0d1420', border: '1px solid #1e2d45', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: '#93c5fd', letterSpacing: 0.8, fontWeight: 700, marginBottom: 10 }}>
            TRAIN PROBABILITY BY HOUR (ALL DAYS)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24,1fr)', gap: 2, height: 120, alignItems: 'flex-end' }}>
            {hourly.map((x) => (
              <div
                key={x.h}
                title={`${hour12(x.h)} — ${x.trains}/${x.total} (${Math.round(x.prob * 100)}%)`}
                style={{
                  height: `${Math.max(2, x.prob * 100)}%`,
                  minHeight: x.total > 0 ? 2 : 0,
                  background: x.prob > 0 ? `rgba(239,68,68,${0.2 + x.prob * 0.8})` : '#0a1018',
                  borderRadius: '2px 2px 0 0',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24,1fr)', gap: 2, marginTop: 4 }}>
            {HOURS.map((h) => (
              <div key={h} style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9', textAlign: 'center' }}>
                {[0, 6, 12, 18].includes(h) ? hour12(h) : h === 23 ? '11p' : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ day, row, maxRatio }) {
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#f1f5f9', display: 'flex', alignItems: 'center' }}>{DAYS[day]}</div>
      {row.map((cell, h) => (
        <div
          key={h}
          title={
            cell.total === 0
              ? `${DAYS[day]} ${hour12(h)} — no data`
              : `${DAYS[day]} ${hour12(h)} — ${cell.trains}/${cell.total} (${Math.round((cell.trains / cell.total) * 100)}%)`
          }
          style={{
            height: 18,
            borderRadius: 2,
            background: cellColor(cell, maxRatio),
            border: '1px solid #0d1420',
          }}
        />
      ))}
    </>
  )
}