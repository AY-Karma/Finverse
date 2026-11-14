import './DataHealthGuide.css'

const STATUSES = [
  { label: 'Quoted', meaning: 'Provider prices within 24 hours.', tone: 'quoted' },
  { label: 'Older quotes', meaning: 'Some provider prices are over 24 hours old.', tone: 'older' },
  { label: 'Partial quotes', meaning: 'Some holdings lack provider prices.', tone: 'partial' },
  { label: 'Imported only', meaning: 'File prices; freshness unknown.', tone: 'imported' },
  { label: 'No prices', meaning: 'No usable prices available.', tone: 'missing' },
]

export function DataHealthGuide() {
  return (
    <div className="data-health-guide">
      <strong className="data-health-guide-title">Price data markers</strong>
      <ul aria-label="Price data marker meanings">
        {STATUSES.map(({ label, meaning, tone }) => (
          <li key={label}>
            <strong><i className={`data-health-marker data-health-marker--${tone}`} aria-hidden="true" />{label}</strong>
            <span>{meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
