import { useMemo, useState, type CSSProperties } from 'react'
import { formatCurrency, type Allocation, type PortfolioPulse } from '../valuation'
import { allocationColor, DitherDonut } from './overview/DitherCharts'
import { DitherBar } from './DitherBar'
import { HiddenValuesState } from './HiddenValuesState'

const SEGMENT_CAP = 7

/** Allocation chart with a compact portfolio summary and optional detail. */
export function AllocationCard({
  allocations,
  hideValues,
  pulse,
}: {
  allocations: Allocation[]
  hideValues: boolean
  pulse: PortfolioPulse
}) {
  const [active, setActive] = useState<number | null>(null)
  const mask = (text: string) => (hideValues ? '••••••' : text)

  const valued = useMemo(() => allocations.filter((a) => a.value > 0), [allocations])
  const total = valued.reduce((sum, item) => sum + item.value, 0)
  const slices = useMemo(() => {
    const top = valued.slice(0, SEGMENT_CAP)
    const restValue = valued.slice(SEGMENT_CAP).reduce((sum, item) => sum + item.value, 0)
    return restValue > 0
      ? [...top, { symbol: `Other · ${valued.length - top.length} more`, value: restValue }]
      : top
  }, [valued])

  if (hideValues) return <HiddenValuesState />

  if (valued.length === 0 || total <= 0) {
    return <div className="alloc-empty muted">No valued holdings yet — refresh prices or check the ledger.</div>
  }

  const activeSlice = active != null ? slices[active] : undefined
  const activeWeight = activeSlice && total > 0 ? (activeSlice.value / total) * 100 : 0

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
          <DitherDonut slices={slices} active={active} onActiveChange={setActive} hidden={hideValues} />
          <div className="alloc-ring-center">
            <div className="alloc-ring-core" aria-hidden="true">
              {activeSlice ? (
                <>
                  <span className="ring-sym" title={mask(activeSlice.symbol)}>{mask(activeSlice.symbol)}</span>
                  <strong>{mask(`${activeWeight.toFixed(1)}%`)}</strong>
                  <small>{mask(formatCurrency(activeSlice.value))}</small>
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
          {slices.map((slice, index) => (
            <li
              key={slice.symbol}
              className={active === index ? 'is-active' : active != null ? 'is-dim' : undefined}
              style={{ '--row-accent': allocationColor(index) } as CSSProperties}
              tabIndex={0}
              onFocus={hoverSlice(index)}
              onBlur={clearSlice}
              onMouseEnter={hoverSlice(index)}
              onMouseLeave={clearSlice}
            >
              <i className="legend-swatch" style={{ background: allocationColor(index) }} />
              <span title={mask(slice.symbol)}>{mask(slice.symbol)}</span>
              <strong>{mask(`${((slice.value / total) * 100).toFixed(1)}%`)}</strong>
            </li>
          ))}
        </ul>
        <ul className="sr-only">
          {slices.map((item) => (
            <li key={item.symbol}>{mask(`${item.symbol} ${((item.value / total) * 100).toFixed(1)}%`)}</li>
          ))}
        </ul>
      </section>

      <section className="alloc-half alloc-bottom" aria-label="Portfolio composition">
        <div className="alloc-summary">
          <div className="alloc-summary-row">
            <div className="alloc-summary-head">
              <span>Breadth</span>
              <strong className="alloc-figure">{priced > 0 ? <>{mask(`${winShare}%`)} in profit</> : 'No priced holdings'}</strong>
            </div>
            <DitherBar segments={[{ value: upShare, color: 'green' }, { value: flatShare, color: 'grey' }, { value: downShare, color: 'red' }]} />
          </div>
          <div className="alloc-summary-row">
            <div className="alloc-summary-head">
              <span>Asset mix</span>
              <strong className="alloc-figure">{splitTotal > 0 ? <>{mask(`${eqShare.toFixed(0)}%`)} equity <span className="alloc-summary-separator">/</span> {mask(`${(100 - eqShare).toFixed(0)}%`)} funds</> : 'No valued assets'}</strong>
            </div>
            <DitherBar segments={[{ value: p.equityValue, color: 'blue' }, { value: p.mutualValue, color: 'purple' }]} />
          </div>
          <div className="alloc-summary-row">
            <div className="alloc-summary-head">
              <span>10%+ positions</span>
              <strong className="alloc-figure">{p.bands.heavy > 0 ? <>{p.bands.heavy} hold {mask(`${p.bandWeight.heavy.toFixed(0)}%`)}</> : 'None'}</strong>
            </div>
            <DitherBar segments={[{ value: p.bandWeight.heavy, color: 'blue' }, { value: p.bandWeight.mid, color: 'purple' }, { value: p.bandWeight.light, color: 'grey' }]} />
          </div>
        </div>

        <details className="alloc-more">
          <summary>More detail</summary>
          <div className="alloc-more-content">
            <section className="alloc-more-section">
              <h3>Profit and loss</h3>
              <p>Priced holdings compared with the amount invested.</p>
              <div className={`alloc-keys${p.flat > 0 ? ' alloc-keys--three' : ' alloc-keys--two'}`}>
                <span className="alloc-key-block alloc-key-block--up">
                  <span className="alloc-key-name"><i className="alloc-dot up" />In profit</span>
                  <strong><span className="alloc-metric-value">{p.up}</span> position{p.up === 1 ? '' : 's'}</strong>
                  <small>{p.avgWinPct != null ? <>Average gain <span className="alloc-metric-value">{mask(`+${p.avgWinPct.toFixed(1)}%`)}</span></> : 'No winning positions'}</small>
                </span>
                {p.flat > 0 && (
                  <span className="alloc-key-block">
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
                  {p.best && <span className={p.best.pct >= 0 ? 'up' : 'down'}>Best <strong title={mask(p.best.symbol)}>{mask(p.best.symbol)}</strong> <b className="alloc-metric-value">{mask(`${p.best.pct >= 0 ? '+' : ''}${p.best.pct.toFixed(1)}%`)}</b></span>}
                  {p.worst && <span className={p.worst.pct >= 0 ? 'up' : 'down'}>Worst <strong title={mask(p.worst.symbol)}>{mask(p.worst.symbol)}</strong> <b className="alloc-metric-value">{mask(`${p.worst.pct >= 0 ? '+' : ''}${p.worst.pct.toFixed(1)}%`)}</b></span>}
                </div>
              )}
            </section>

            <section className="alloc-more-section">
              <h3>Equity and funds</h3>
              <p>{splitTotal > 0 ? `${mask(formatCurrency(splitTotal))} total value` : 'No valued assets'}</p>
              <div className="alloc-keys alloc-keys--two">
                <span className="alloc-key-block alloc-key-block--equity">
                  <span className="alloc-key-name"><i className="alloc-dot equity" />Equity</span>
                  <strong>{mask(formatCurrency(p.equityValue))}</strong>
                  <small>{p.equityCount} position{p.equityCount === 1 ? '' : 's'} · {splitTotal > 0 ? mask(`${eqShare.toFixed(0)}%`) : '—'}</small>
                </span>
                <span className="alloc-key-block alloc-key-block--funds">
                  <span className="alloc-key-name"><i className="alloc-dot funds" />Mutual funds</span>
                  <strong>{mask(formatCurrency(p.mutualValue))}</strong>
                  <small>{p.mutualCount} fund{p.mutualCount === 1 ? '' : 's'} · {splitTotal > 0 ? mask(`${(100 - eqShare).toFixed(0)}%`) : '—'}</small>
                </span>
              </div>
              {leader && smallest && (
                <div className="alloc-edge-notes alloc-edge-notes--holdings">
                  <span>Largest <strong title={mask(leader.symbol)}>{mask(leader.symbol)}</strong> · {mask(`${((leader.value / total) * 100).toFixed(1)}%`)}</span>
                  <span>Smallest <strong title={mask(smallest.symbol)}>{mask(smallest.symbol)}</strong> · {mask(`${((smallest.value / total) * 100).toFixed(1)}%`)}</span>
                </div>
              )}
            </section>

            <section className="alloc-more-section">
              <h3>Weight bands</h3>
              <p>Share of portfolio value held by each group.</p>
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
              <p className="alloc-member-note">{p.bands.heavy > 0 ? <><strong>Large positions</strong> {heavyMembers}.</> : 'No position accounts for 10% or more of the portfolio.'}</p>
            </section>
          </div>
        </details>
      </section>
    </div>
  )
}
