import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
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

export function Overview({ onGoTo }: { onGoTo: (v: View) => void }) {
  const { positions } = useStore()
  const stats = computeStats(positions)

  if (positions.length === 0) {
    return (
      <div className="card" style={{ display: 'grid', gap: 16, textAlign: 'center', padding: 48 }}>
        <div className="eyebrow">Finverse</div>
        <h1 className="page-title">Track your investments.</h1>
        <p className="hint" style={{ maxWidth: 440, margin: '0 auto' }}>
          Upload an Excel or CSV export of your holdings to see your portfolio at a glance and get
          AI-guided analysis.
        </p>
        <div>
          <button className="btn btn--primary" onClick={() => onGoTo('import')}>
            Import portfolio
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div>
        <div className="eyebrow">Portfolio</div>
        <h1 className="page-title">Overview</h1>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="stat-label">Invested</div>
          <div className="stat-value">{formatCurrency(stats.invested)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Current value</div>
          <div className="stat-value">{formatCurrency(stats.currentValue)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Unrealized P&L</div>
          <div className={`stat-value ${stats.pnl >= 0 ? 'up' : 'down'}`}>
            {stats.pnl >= 0 ? '+' : ''}
            {formatCurrency(stats.pnl)}
          </div>
          <div className={`hint ${stats.pnlPct >= 0 ? 'up' : 'down'}`}>
            {formatPercent(stats.pnlPct)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 24 }}>
        <div className="card">
          <div className="stat-label">Holdings</div>
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
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.ticker}</td>
                    <td className="muted">{p.type}</td>
                    <td>{p.quantity}</td>
                    <td>{p.buyPrice}</td>
                    <td>{formatCurrency(value)}</td>
                    <td className={pnl != null ? (pnl >= 0 ? 'up' : 'down') : 'muted'}>
                      {pnl != null ? formatCurrency(pnl) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="stat-label">Allocation</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.allocations}
                  dataKey="value"
                  nameKey="symbol"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                >
                  {stats.allocations.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatCurrency(v == null ? 0 : Number(v))}
                  contentStyle={{
                    background: '#141516',
                    border: '1px solid #34343a',
                    borderRadius: 8,
                    color: '#f7f8f8',
                  }}
                />
                <Legend iconType="circle" formatter={(v) => <span style={{ color: '#d0d6e0' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  )
}