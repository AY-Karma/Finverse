import { useMemo, useState, type CSSProperties } from 'react'
import type { Currency } from '../types'
import { formatCurrency, type Allocation, type PortfolioPulse } from '../valuation'

const PALETTE = [
  '#7c89e8',
  '#5fae9b',
  '#d0a35c',
  '#c97b84',
  '#6aa9c9',
  '#a685c9',
  '#96b862',
  '#8a93a6',
]

const SEGMENT_CAP = 7

const CX = 100
const CY = 100
const R_OUTER = 96
const R_INNER = 61

function polar(r: number, deg: number): { x: number; y: number } {
  // 0deg sits at 12 o'clock, matching allocation order clockwise.
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

function slicePath(startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0
  const a = polar(R_OUTER, startDeg)
  const b = polar(R_OUTER, endDeg)
  const c = polar(R_INNER, endDeg)
  const d = polar(R_INNER, startDeg)
  return [
    `M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    `L ${c.x.toFixed(2)} ${c.y.toFixed(2)}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/** Allocation card: a 50/50 split. The top half pairs an SVG donut with a live
 *  legend (hovering either highlights both); the bottom half details breadth,
 *  asset split and weight bands for the whole book. */
export function AllocationCard({
  allocations,
  hideValues,
  currency,
  usdInrRate,
  pulse,
}: {
  allocations: Allocation[]
  hideValues: boolean
  currency: Currency
  usdInrRate?: number | null
  pulse: PortfolioPulse
}) {
  const [active, setActive] = useState<number | null>(null)
  const mask = (text: string) => (hideValues ? '••••••' : text)

  const valued = useMemo(() => allocations.filter((a) => a.value > 0), [allocations])
  const total = valued.reduce((sum, item) => sum + item.value, 0)
  const top = valued.slice(0, SEGMENT_CAP)
  const restValue = total > 0 ? total - top.reduce((sum, item) => sum + item.value, 0) : 0
  const slices = restValue > 0
    ? [...top, { symbol: `Other · ${valued.length - top.length} more`, value: restValue }]
    : top
  let angle = 0
  const stops = slices.map((item, index) => {
    const start = angle
    angle += total > 0 ? (item.value / total) * 360 : 0
    return { start, end: angle, color: PALETTE[index % PALETTE.length], item }
  })

  if (valued.length === 0 || total <= 0) {
    return <div className="alloc-empty muted">No valued holdings yet — refresh prices or check the ledger.</div>
  }

  const activeStop = active != null ? stops[active] : undefined
  const activeWeight = activeStop && total > 0 ? (activeStop.item.value / total) * 100 : 0

  const p = pulse
  const priced = p.up + p.down + p.flat
  const upShare = priced > 0 ? (p.up / priced) * 100 : 0
  const downShare = priced > 0 ? (p.down / priced) * 100 : 0
  const flatShare = priced > 0 ? (p.flat / priced) * 100 : 0
  const winShare = priced > 0 ? Math.round((p.up / priced) * 100) : 0
  const splitTotal = p.equityValue + p.mutualValue
  const eqShare = splitTotal > 0 ? (p.equityValue / splitTotal) * 100 : 0
  const leader = valued[0]
  const smallest = valued[valued.length - 1]
  const heavyMembers = p.bandMembers.heavy.map(mask).join(', ')

  const hoverSlice = (index: number) => () => setActive(index)
  const clearSlice = () => setActive(null)

  return (
    <div className="alloc-split">
      <section className="alloc-half alloc-top">
        <div className="alloc-donut">
          <svg viewBox="0 0 200 200" role="img" aria-label={hideValues ? 'Portfolio allocation hidden' : `Allocation across ${valued.length} holdings; hover a slice or the legend for details`}>
            {/* Visual layer: pointer-events off so the pop-out can never chase
                the cursor out of its own bounds. */}
            <g style={{ pointerEvents: 'none' }}>
              {stops.map((stop, index) => {
                const isActive = active === index
                const isDim = active != null && !isActive
                const mid = (stop.start + stop.end) / 2
                const pop = isActive ? 6 : 0
                const dx = Math.sin((mid * Math.PI) / 180) * pop
                const dy = -Math.cos((mid * Math.PI) / 180) * pop
                // A hairline of arc stays so one full-circle slice still renders.
                const start = stop.start + 0.08
                const end = Math.max(stop.start + 0.16, stop.end - 0.08)
                return (
                  <path
                    key={stop.item.symbol}
                    d={slicePath(start, end)}
                    fill={stop.color}
                    className={`alloc-slice${isActive ? ' is-active' : ''}${isDim ? ' is-dim' : ''}`}
                    style={{ transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` }}
                  />
                )
              })}
            </g>
            {/* Static hit wedges own the pointer; boundaries meet exactly so
                sweeping across seams cannot leave the chart. */}
            <g style={{ pointerEvents: 'all' }}>
              {stops.map((stop, index) => (
                <path
                  key={stop.item.symbol}
                  d={slicePath(stop.start, Math.max(stop.start + 0.16, stop.end))}
                  fill="transparent"
                  onMouseEnter={hoverSlice(index)}
                  onMouseLeave={clearSlice}
                />
              ))}
            </g>
          </svg>
          <div className="alloc-ring-center">
            <div className="alloc-ring-core" aria-hidden="true">
              {activeStop ? (
                <>
                  <span className="ring-sym" title={mask(activeStop.item.symbol)}>{mask(activeStop.item.symbol)}</span>
                  <strong>{mask(`${activeWeight.toFixed(1)}%`)}</strong>
                  <small>{mask(formatCurrency(activeStop.item.value, currency, usdInrRate))}</small>
                </>
              ) : (
                <>
                  <span>Holdings</span>
                  <strong>{valued.length}</strong>
                </>
              )}
            </div>
          </div>
        </div>
        <ul className="alloc-legend">
          {slices.slice(0, 6).map((slice, index) => (
            <li
              key={slice.symbol}
              className={active === index ? 'is-active' : active != null ? 'is-dim' : undefined}
              style={{ '--row-accent': stops[index]?.color } as CSSProperties}
              onMouseEnter={hoverSlice(index)}
              onMouseLeave={clearSlice}
            >
              <i className="legend-swatch" style={{ background: stops[index]?.color ?? 'transparent' }} />
              <span title={slice.symbol}>{slice.symbol}</span>
              <strong>{mask(`${((slice.value / total) * 100).toFixed(1)}%`)}</strong>
            </li>
          ))}
        </ul>
        <ul className="sr-only">
          {slices.map((item) => (
            <li key={item.symbol}>{`${item.symbol} ${((item.value / total) * 100).toFixed(1)}%`}</li>
          ))}
        </ul>
      </section>

      <section className="alloc-half alloc-bottom">
        <div className="alloc-sections">
          <section className="alloc-section">
            <header className="alloc-section-head">
              <span className="alloc-label">Breadth</span>
              <strong className="alloc-figure">{priced > 0 ? `${winShare}% of priced holdings in profit` : '—'}</strong>
            </header>
            <p className="alloc-description">Compares each priced holding's current value with the amount invested.</p>
            <div className="alloc-bar" aria-hidden="true">
              <i className="alloc-fill-up" style={{ width: `${upShare}%` }} />
              <i className="alloc-fill-flat" style={{ width: `${flatShare}%` }} />
              <i className="alloc-fill-down" style={{ width: `${downShare}%` }} />
            </div>
            <div className={`alloc-keys alloc-keys--breadth${p.flat > 0 ? ' alloc-keys--three' : ' alloc-keys--two'}`}>
              <span className="alloc-key-block alloc-key-block--up">
                <span className="alloc-key-name"><i className="alloc-dot up" />In profit</span>
                <strong><span className="alloc-metric-value">{p.up}</span> position{p.up === 1 ? '' : 's'}</strong>
                <small>{p.avgWinPct != null ? <>Average gain <span className="alloc-metric-value">{mask(`+${p.avgWinPct.toFixed(1)}%`)}</span></> : 'No winning positions'}</small>
              </span>
              {p.flat > 0 && (
                <span className="alloc-key-block alloc-key-block--flat">
                  <span className="alloc-key-name"><i className="alloc-dot flat" />At cost</span>
                  <strong>{p.flat} position{p.flat === 1 ? '' : 's'}</strong>
                  <small>No gain or loss</small>
                </span>
              )}
              <span className="alloc-key-block alloc-key-block--down">
                <span className="alloc-key-name"><i className="alloc-dot down" />In loss</span>
                <strong><span className="alloc-metric-value">{p.down}</span> position{p.down === 1 ? '' : 's'}</strong>
                <small>{p.avgLossPct != null ? <>Average loss <span className="alloc-metric-value">{mask(`${p.avgLossPct.toFixed(1)}%`)}</span></> : 'No losing positions'}</small>
              </span>
            </div>
            {(p.best || p.worst) && (
              <div className="alloc-edge-notes">
                {p.best && <span className={p.best.pct >= 0 ? 'up' : 'down'}>Best <strong title={p.best.symbol}>{mask(p.best.symbol)}</strong> <b className="alloc-metric-value">{mask(`${p.best.pct >= 0 ? '+' : ''}${p.best.pct.toFixed(1)}%`)}</b></span>}
                {p.worst && <span className={p.worst.pct >= 0 ? 'up' : 'down'}>Worst <strong title={p.worst.symbol}>{mask(p.worst.symbol)}</strong> <b className="alloc-metric-value">{mask(`${p.worst.pct >= 0 ? '+' : ''}${p.worst.pct.toFixed(1)}%`)}</b></span>}
              </div>
            )}
          </section>

          <section className="alloc-section">
            <header className="alloc-section-head">
              <span className="alloc-label">Equity vs funds</span>
              <strong className="alloc-figure">{splitTotal > 0 ? mask(formatCurrency(splitTotal, currency, usdInrRate)) : '—'}</strong>
            </header>
            <p className="alloc-description">Shows how the portfolio's current value is split between shares and mutual funds.</p>
            <div className="alloc-bar" aria-hidden="true">
              <i className="alloc-fill-equity" style={{ width: `${eqShare}%` }} />
              <i className="alloc-fill-funds" style={{ width: `${100 - eqShare}%` }} />
            </div>
            <div className="alloc-keys alloc-keys--two">
              <span className="alloc-key-block alloc-key-block--equity">
                <span className="alloc-key-name"><i className="alloc-dot equity" />Equity</span>
                <strong>{mask(formatCurrency(p.equityValue, currency, usdInrRate))}</strong>
                <small>{p.equityCount} position{p.equityCount === 1 ? '' : 's'} · {splitTotal > 0 ? mask(`${eqShare.toFixed(0)}%`) : '—'}</small>
              </span>
              <span className="alloc-key-block alloc-key-block--funds">
                <span className="alloc-key-name"><i className="alloc-dot funds" />Mutual funds</span>
                <strong>{mask(formatCurrency(p.mutualValue, currency, usdInrRate))}</strong>
                <small>{p.mutualCount} fund{p.mutualCount === 1 ? '' : 's'} · {splitTotal > 0 ? mask(`${(100 - eqShare).toFixed(0)}%`) : '—'}</small>
              </span>
            </div>
            {leader && smallest && (
              <div className="alloc-edge-notes alloc-edge-notes--holdings">
                <span>Largest <strong title={leader.symbol}>{mask(leader.symbol)}</strong> · {mask(`${((leader.value / total) * 100).toFixed(1)}%`)}</span>
                <span>Smallest <strong title={smallest.symbol}>{mask(smallest.symbol)}</strong> · {mask(`${((smallest.value / total) * 100).toFixed(1)}%`)}</span>
              </div>
            )}
          </section>

          <section className="alloc-section">
            <header className="alloc-section-head">
              <span className="alloc-label">Weight bands</span>
              <strong className="alloc-figure">{p.bands.heavy} position{p.bands.heavy === 1 ? '' : 's'} at 10%+</strong>
            </header>
            <p className="alloc-description">Groups positions by the share of total portfolio value each one represents.</p>
            <div className="alloc-bar" aria-hidden="true">
              <BandSegments weights={[p.bandWeight.heavy, p.bandWeight.mid, p.bandWeight.light]} />
            </div>
            <div className="alloc-keys alloc-keys--three">
              <span className="alloc-key-block">
                <span className="alloc-key-name"><i className="alloc-dot band-heavy" />10% or more</span>
                <strong>{p.bands.heavy} position{p.bands.heavy === 1 ? '' : 's'}</strong>
                <small>{mask(`${p.bandWeight.heavy.toFixed(0)}%`)} of portfolio</small>
              </span>
              <span className="alloc-key-block">
                <span className="alloc-key-name"><i className="alloc-dot band-mid" />5% to under 10%</span>
                <strong>{p.bands.mid} position{p.bands.mid === 1 ? '' : 's'}</strong>
                <small>{mask(`${p.bandWeight.mid.toFixed(0)}%`)} of portfolio</small>
              </span>
              <span className="alloc-key-block">
                <span className="alloc-key-name"><i className="alloc-dot band-light" />Under 5%</span>
                <strong>{p.bands.light} position{p.bands.light === 1 ? '' : 's'}</strong>
                <small>{mask(`${p.bandWeight.light.toFixed(0)}%`)} of portfolio</small>
              </span>
            </div>
            <p className="alloc-member-note">{p.bands.heavy > 0 ? <><strong>Large positions</strong> {heavyMembers}. Together they make up {mask(`${p.bandWeight.heavy.toFixed(0)}%`)} of the portfolio.</> : 'No position accounts for 10% or more of the portfolio.'}</p>
          </section>
        </div>
      </section>
    </div>
  )
}

function BandSegments({ weights }: { weights: [number, number, number] }) {
  const sum = weights[0] + weights[1] + weights[2]
  if (sum <= 0) return null
  const tones = ['band-heavy', 'band-mid', 'band-light']
  return (
    <>
      {weights.map((weight, index) => (
        <i key={index} className={tones[index]} style={{ width: `${(weight / sum) * 100}%` }} />
      ))}
    </>
  )
}
