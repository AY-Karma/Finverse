import { useId } from 'react'
import './recapArtwork.css'

type RecapArtworkKind = 'winners' | 'laggards' | 'updates' | 'covered'

export function RecapArtwork({ kind, points }: { kind: RecapArtworkKind; points?: number[] }) {
  const gradientId = useId()
  if (kind === 'winners' || kind === 'laggards') {
    if (!points || points.length < 2 || !points.every((point) => Number.isFinite(point) && point >= 0)) {
      return <svg className="recap-artwork recap-artwork--empty" viewBox="0 0 400 220" fill="none" aria-hidden="true" focusable="false">
        <path d="M40 72h320M40 110h320M40 148h320" stroke="currentColor" strokeDasharray="2 7" />
        <circle cx="200" cy="110" r="24" fill="var(--surface-1)" stroke="currentColor" strokeDasharray="3 5" />
      </svg>
    }
    const low = Math.min(...points)
    const high = Math.max(...points)
    const range = high - low
    const coordinates = points.map((point, index) => ({
      x: 32 + index / (points.length - 1) * 336,
      y: range === 0 ? 110 : 176 - (point - low) / range * 132,
    }))
    const line = coordinates.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
    const end = coordinates[coordinates.length - 1]
    return <svg className={`recap-artwork recap-artwork--${kind}`} viewBox="0 0 400 220" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".17" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path className="recap-chart-grid" d="M32 44h336M32 88h336M32 132h336M32 176h336M88 28v164M200 28v164M312 28v164" />
      <path className="recap-chart-area" d={`${line} L368 196 L32 196 Z`} fill={`url(#${gradientId})`} />
      <path className="recap-chart-glow" d={line} pathLength="1" />
      <path className="recap-chart-line" d={line} pathLength="1" />
      <g className="recap-chart-tip"><circle className="recap-chart-tip-ring" cx={end.x} cy={end.y} r="10" /><circle cx={end.x} cy={end.y} r="3.5" fill="currentColor" /></g>
    </svg>
  }

  if (kind === 'updates') return <svg className="recap-artwork recap-artwork--updates" viewBox="0 0 400 220" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="200" cy="196" rx="112" ry="9" fill="currentColor" opacity=".05" />
    <g className="recap-document recap-document--back"><rect x="130" y="36" width="148" height="150" rx="10" fill="var(--story-art-back)" stroke="currentColor" strokeOpacity=".25" /></g>
    <g className="recap-document recap-document--middle"><rect x="116" y="26" width="148" height="150" rx="10" fill="var(--story-art-back)" stroke="currentColor" strokeOpacity=".4" /></g>
    <g className="recap-document recap-document--front">
      <rect x="102" y="16" width="148" height="150" rx="10" fill="var(--surface-1)" stroke="currentColor" strokeOpacity=".7" />
      <path d="M122 42h52M122 51h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      {[77, 103, 129].map((y, index) => <g className="recap-document-row" key={y} style={{ animationDelay: `${.35 + index * .12}s` }}>
        <rect x="122" y={y - 6} width="12" height="12" rx="3" fill="currentColor" opacity=".15" />
        <path d={`M144 ${y}h44m18 0h24`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
      </g>)}
    </g>
    <g className="recap-update-seal"><circle cx="264" cy="143" r="32" fill="var(--surface-1)" stroke="currentColor" strokeWidth="1.5" /><path className="recap-check" d="m251 143 9 9 17-18" pathLength="1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g>
  </svg>

  return <svg className="recap-artwork recap-artwork--covered" viewBox="0 0 400 220" fill="none" aria-hidden="true" focusable="false">
    <defs><radialGradient id={`${gradientId}-covered`}><stop stopColor="var(--recap-complete)" stopOpacity=".2" /><stop offset="1" stopColor="var(--recap-complete)" stopOpacity="0" /></radialGradient></defs>
    <circle className="recap-covered-aura" cx="200" cy="110" r="106" fill={`url(#${gradientId}-covered)`} />
    <circle className="recap-covered-orbit" cx="200" cy="110" r="88" stroke="currentColor" strokeOpacity=".14" />
    <circle className="recap-covered-trail" cx="200" cy="110" r="88" strokeWidth="2" strokeDasharray="70 483" strokeLinecap="round" />
    <circle cx="200" cy="110" r="68" stroke="currentColor" strokeOpacity=".12" strokeDasharray="2 8" />
    <circle className="recap-covered-disc" cx="200" cy="110" r="48" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".5" />
    <path className="recap-check recap-covered-check" d="m180 110 14 14 27-29" pathLength="1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <g className="recap-covered-satellite"><circle cx="276" cy="66" r="4" fill="currentColor" /><circle cx="124" cy="154" r="3" fill="var(--recap-complete)" /></g>
    <g className="recap-covered-sparks" strokeWidth="1.5" strokeLinecap="round"><path d="M91 70v10m-5-5h10M299 153v10m-5-5h10" /><path d="m286 37 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" /></g>
  </svg>
}
