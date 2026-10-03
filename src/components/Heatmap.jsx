import { useMemo, useState } from 'react'
import { CORRIDOR } from '../data/crossings'
import HeatmapStat from './HeatmapStat'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

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

  const filtered = useMemo(
    () => (filterId === 'all' ? history : history.filter((r) => r.crossingId === filterId)),
    [history, filterId]
  )

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

  const filters = [{ id: 'all', name: 'All Crossings' }, ...CORRIDOR]
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
                color: active ? '#60a5fa' : '#475569',
                borderRadius: 7,
                padding: '6px 10px',
                fontSize: 11,
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
        <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(24,1fr)', gap: 2, minWidth: 600 }}>
          <div />
          {HOURS.map((h) => (
            <div key={h} style={{ fontSize: 8, color: '#475569', textAlign: 'center' }}>
              {h % 3 === 0 ? `${h}h` : ''}
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
                title={`${x.h}:00 — ${x.trains}/${x.total} (${Math.round(x.prob * 100)}%)`}
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
              <div key={h} style={{ fontSize: 8, color: '#475569', textAlign: 'center' }}>
                {[0, 6, 12, 18, 23].includes(h) ? `${h}h` : ''}
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
      <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center' }}>{DAYS[day]}</div>
      {row.map((cell, h) => (
        <div
          key={h}
          title={
            cell.total === 0
              ? `${DAYS[day]} ${h}:00 — no data`
              : `${DAYS[day]} ${h}:00 — ${cell.trains}/${cell.total} (${Math.round((cell.trains / cell.total) * 100)}%)`
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