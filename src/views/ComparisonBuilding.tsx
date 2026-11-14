export function ComparisonBuilding({ loading }: { loading: boolean }) {
  return <svg className="comparison-building" data-building={loading} viewBox="0 0 176 96" fill="none" aria-hidden="true" focusable="false">
    <path className="comparison-building-ground" d="M12 84h152M24 28h128M48 12v72M88 12v72M128 12v72" />
    <path className="comparison-building-outline" d="M28 84V52h32V24h48v16h36v44" />
    <g className="comparison-building-floor"><path d="M28 72h116M38 72v12m12-12v12m24-12v12m20-12v12m24-12v12m16-12v12" /></g>
    <g className="comparison-building-floor"><path d="M28 60h116M38 60v12m12-12v12m24-12v12m20-12v12m24-12v12m16-12v12" /></g>
    <g className="comparison-building-floor"><path d="M60 48h84M74 48v12m20-12v12m24-12v12m16-12v12" /></g>
    <g className="comparison-building-floor"><path d="M60 36h48M74 36v12m20-12v12" /></g>
    <g className="comparison-building-floor"><path d="M60 24h48M74 24v12m20-12v12" /></g>
    <path className="comparison-building-outline" d="M82 84V72h12v12" />
  </svg>
}
