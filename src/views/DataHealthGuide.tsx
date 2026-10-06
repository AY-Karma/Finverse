import './DataHealthGuide.css'

type DataHealthGuideProps = {
  healthLabel: string
  allowExternalData: boolean
}

export function DataHealthGuide({ healthLabel, allowExternalData }: DataHealthGuideProps) {
  const refreshAction = allowExternalData
    ? 'Refresh prices on Overview'
    : 'Enable External market data in Settings > Data & privacy, then refresh prices on Overview'
  const statuses = [
    {
      label: 'Quoted',
      meaning: 'Every holding has a provider price, and none is over 24 hours old. These can be closing prices or NAVs, not real-time quotes.',
      action: 'No repair needed. Refresh prices on Overview when you want to check for newer prices.',
    },
    {
      label: 'Older quotes',
      meaning: 'Every holding has a provider price, but at least one is over 24 hours old. This can happen when markets are closed.',
      action: `Wait for the next trading session or NAV update, then ${allowExternalData ? 'refresh prices on Overview' : 'enable External market data in Settings > Data & privacy and refresh prices on Overview'}.`,
    },
    {
      label: 'Partial quotes',
      meaning: 'Some holdings have provider prices. The rest use imported prices or have no price.',
      action: `${refreshAction}. If a holding stays unquoted, review its ticker, exchange or fund identifier in your import file. Some assets may be unsupported.`,
    },
    {
      label: 'Imported only',
      meaning: 'Only imported prices are available. The app cannot tell when those prices were last updated.',
      action: `Import a recent holdings file with last prices in Settings > Manage holdings, or ${allowExternalData ? 'refresh prices on Overview' : 'enable External market data in Settings > Data & privacy to fetch provider prices'}.`,
    },
    {
      label: 'No prices',
      meaning: 'No holding has a usable provider or imported price, so the portfolio cannot be valued.',
      action: `Add a Last Price column to your holdings file and import it in Settings > Manage holdings, or ${allowExternalData ? 'refresh prices on Overview' : 'enable External market data in Settings > Data & privacy to fetch provider prices'}.`,
    },
  ]

  return (
    <div className="data-health-guide">
      <div className="data-health-guide-head">
        <h3>What each status means</h3>
        <p>Data health describes price coverage and freshness.</p>
      </div>
      {!allowExternalData && (
        <p className="data-health-guide-off">
          External market data is off. You can enable it in <a href="/app/settings">Settings</a> under Data &amp; privacy, or keep using imported prices.
        </p>
      )}
      <ul className="data-health-guide-list" aria-label="Data health statuses">
        {statuses.map((status) => {
          const current = status.label === healthLabel
          return (
            <li key={status.label} aria-current={current ? 'true' : undefined}>
              <div className="data-health-guide-label">
                <strong>{status.label}</strong>
                {current && <span className="data-health-guide-current">Current status</span>}
              </div>
              <div>
                <span className="data-health-guide-caption">Meaning</span>
                <p>{status.meaning}</p>
              </div>
              <div>
                <span className="data-health-guide-caption">What to do</span>
                <p>{status.action}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
