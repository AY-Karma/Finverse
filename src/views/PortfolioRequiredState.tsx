interface PortfolioRequiredStateProps {
  area: string
  description: string
  onImport: () => void
}

export function PortfolioRequiredState({ area, description, onImport }: PortfolioRequiredStateProps) {
  return (
    <div className="overview-empty enter">
      <div>
        <div className="page-eyebrow">{area}</div>
        <h1 className="page-title">Import your portfolio to start.</h1>
        <p className="page-sub">{description}</p>
      </div>
      <button className="btn btn--primary" type="button" onClick={onImport}>
        Bring in your portfolio →
      </button>
    </div>
  )
}
