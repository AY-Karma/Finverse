import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec, Currency } from './types'

const CHART_COLORS = [
  '#5e6ad2',
  '#828fff',
  '#7a7fad',
  '#8a8f98',
  '#4a5bb0',
  '#a0a5b5',
  '#6d78d8',
  '#9a9fd0',
]

const AXIS_STYLE = { fill: '#8a8f98', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }

function fmtValue(n: number, currency: Currency): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n)
  }
  const abs = Math.abs(n)
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function ChatChart({ spec, currency = 'INR' }: { spec: ChartSpec; currency?: Currency }) {
  const bounded = spec.data
    .filter((row) => row && typeof row.label === 'string' && Number.isFinite(row.value))
    .slice(0, 20)
    .map((row) => ({ label: row.label.slice(0, 120), value: row.value }))
  const data: ChartSpec['data'] = bounded.length ? bounded : [{ label: 'No data', value: 0 }]

  return (
    <div className="chat-chart">
      {spec.title && <div className="chat-chart-title">{spec.title}</div>}
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === 'pie' ? (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={52}
                outerRadius={92}
                paddingAngle={2}
                stroke="transparent"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => fmtValue(Number(v), currency)}
                contentStyle={{ background: '#151619', border: '1px solid #32343b', borderRadius: 8, color: '#f7f8f8', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#8a8f98' }} />
            </PieChart>
          ) : spec.kind === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22242a" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_STYLE} interval={0} angle={data.length > 6 ? -28 : 0} height={data.length > 6 ? 58 : 30} textAnchor={data.length > 6 ? 'end' : 'middle'} />
              <YAxis tick={AXIS_STYLE} width={70} tickFormatter={(v: number) => fmtValue(v, currency)} />
              <Tooltip
                formatter={(v) => fmtValue(Number(v), currency)}
                contentStyle={{ background: '#151619', border: '1px solid #32343b', borderRadius: 8, color: '#f7f8f8', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22242a" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_STYLE} interval={0} angle={data.length > 6 ? -28 : 0} height={data.length > 6 ? 58 : 30} textAnchor={data.length > 6 ? 'end' : 'middle'} />
              <YAxis tick={AXIS_STYLE} width={70} tickFormatter={(v: number) => fmtValue(v, currency)} />
              <Tooltip
                formatter={(v) => fmtValue(Number(v), currency)}
                contentStyle={{ background: '#151619', border: '1px solid #32343b', borderRadius: 8, color: '#f7f8f8', fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
