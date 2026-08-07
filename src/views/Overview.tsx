import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { computeStats, formatCurrency, formatPercent } from '../store'
import { useStore } from '../useStore'
import type { View } from '../useStore'

const PIE_COLORS = [
  '#5e6ad2',
  '#828fff',
  '#7a7fad',
  '#8a8f98',
  '#4a5bb0',
  '#a0a5b5',
  '#6d78d8',
  '#9a9fd0',
]

const TOOLTIP_STYLE = {
  background: '#151619',
  border: '1px solid #32343b',
  borderRadius: 8,
  color: '#f7f8f8',
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 12,
}

export function Overview({ onGoTo }: { onGoTo: (v: View) => void }) {
  const { positions } = useStore()
  const stats = computeStats(positions)

  if (positions.length === 0) {
    return (
      <div className="enter" style={{ display: 'grid', gap: 28, justifyItems: 'center', padding: '12vh 24px', textAlign: 'center' }}>
        <div>
          <div className="page-eyebrow">Finverse — Live Market Scoreboard</div>
          <h1 className="page-title" style={{ textTransform: 'none', maxWidth: 720 }}>
            Step into the arena.
          </h1>
          <p className="page-sub" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', marginTop: 12 }}>
            Upload your holdings and Finverse turns a spreadsheet into a live scoreboard — allocation,
            performance, and AI-guided analysis in one command rail.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => onGoTo('import')}>
          Import portfolio →
        </button>
      </div>
    )
  }

  const pnlUp = stats.pnl >= 0
  const best = positions
    .filter((p) => p.lastPrice != null && p.invested > 0)
    .sort(
      (a, b) =>
        ((b.lastPrice! - b.buyPrice) / b.buyPrice) * 100 -
        ((a.lastPrice! - a.buyPrice) / a.buyPrice) * 100,
    )[0]
  const bestPct =
    best && best.lastPrice != null && best.buyPrice > 0
      ? ((best.lastPrice - best.buyPrice) / best.buyPrice) * 100
      : null

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">Live Market Scoreboard</div>
          <h1 className="page-title">Your Arena</h1>
        </div>
        <p className="page-sub">
          Net position across {positions.length} holding{positions.length === 1 ? '' : 's'} — refreshed
          from the last known prices in your sheet.
        </p>
      </div>

      {/* Scoreboard */}
      <div className="scoreboard enter d1">
        <div className="score">
          <div className="score-label">
            <span>Current Value</span>
            <span className="live-dot" />
          </div>
          <div className="score-value">{formatCurrency(stats.currentValue)}</div>
          <div className="score-foot">Total market exposure</div>
        </div>
        <div className="score">
          <div className="score-label">Invested</div>
          <div className="score-value">{formatCurrency(stats.invested)}</div>
          <div className="score-foot">Cost basis deployed</div>
        </div>
        <div className="score">
          <div className="score-label">
            <span>Unrealized P&L</span>
            <span className="nav-index">{pnlUp ? '' : ''}</span>
          </div>
          <div className={`score-value ${pnlUp ? 'up' : 'down'}`}>
            {pnlUp ? '+' : ''}
            {formatCurrency(stats.pnl)}
          </div>
          <div className={`score-foot ${pnlUp ? 'up' : 'down'}`}>
            {formatPercent(stats.pnlPct)} on cost
          </div>
        </div>
        <div className="score">
          <div className="score-label">Best Performer</div>
          <div className="score-value sym">{best ? best.ticker : '—'}</div>
          <div className={`score-foot ${bestPct != null ? (bestPct >= 0 ? 'up' : 'down') : ''}`}>
            {bestPct != null ? `${bestPct >= 0 ? '+' : ''}${bestPct.toFixed(2)}%` : 'Spread the field'}
          </div>
        </div>
      </div>

      {/* Ticker tape */}
      <div className="tiker-wrap enter d2">
        <div className="ticker">
          <div className="ticker-track">
            {tickerItems(positions).map((t, i) => (
              <TickerCell key={i} t={t} />
            ))}
            {tickerItems(positions).map((t, i) => (
              <TickerCell key={`dup-${i}`} t={t} />
            ))}
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="span-grid enter d3">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">The Ledger</span>
            <span className="section-index">01 · Holdings</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Buy</th>
                <th>Value</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const value = p.lastPrice != null ? p.lastPrice * p.quantity : p.invested
                const pnl = p.lastPrice != null ? value - p.invested : null
                const pnlUp = pnl != null && pnl >= 0
                return (
                  <tr key={p.id}>
                    <td className="sym">{p.ticker}</td>
                    <td className="muted">{p.type}</td>
                    <td>{p.quantity}</td>
                    <td>{p.buyPrice}</td>
                    <td>{formatCurrency(value)}</td>
                    <td className={pnl != null ? (pnlUp ? 'up' : 'down') : 'muted'}>
                      {pnl != null ? `${pnlUp ? '+' : ''}${formatCurrency(pnl)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Allocation Mix</span>
            <span className="section-index">02 · Exposure</span>
          </div>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.allocations}
                  dataKey="value"
                  nameKey="symbol"
                  innerRadius={68}
                  outerRadius={116}
                  paddingAngle={2}
                  stroke="transparent"
                >
                  {stats.allocations.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v == null ? 0 : Number(v))} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="panel-head" style={{ marginTop: 4, marginBottom: 0 }}>
            <span className="epsilon">Top exposure by symbol</span>
            <span className="section-index">{stats.allocations.length} shown</span>
          </div>
        </div>
      </div>
    </>
  )
}

interface TickerCellData {
  sym: string
  val: string
  delta: number | null
  pct: number | null
}

function tickerItems(positions: ReturnType<typeof useStore>['positions']): TickerCellData[] {
  return positions
    .map((p) => {
      const value = p.lastPrice != null ? p.lastPrice * p.quantity : p.invested
      const delta = p.lastPrice != null ? value - p.invested : null
      const pct = p.lastPrice != null && p.invested > 0 ? ((delta! / p.invested) * 100) : null
      return { sym: p.ticker, val: formatCurrency(value), delta, pct }
    })
    .slice(0, 24)
}

function TickerCell({ t }: { t: TickerCellData }) {
  const up = t.delta != null && t.delta >= 0
  return (
    <div className="ticker-item">
      <span className="ticker-sym">{t.sym}</span>
      <span className="ticker-val">{t.val}</span>
      <span className={`ticker-delta ${up ? 'up' : 'down'}`}>
        {t.pct != null ? `${up ? '+' : ''}${t.pct.toFixed(2)}%` : '—'}
      </span>
    </div>
  )
}