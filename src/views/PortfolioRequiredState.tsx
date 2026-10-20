import { ActionIcon } from './ActionIcon'

interface PortfolioRequiredStateProps {
  area: string
  description: string
  onImport: () => void
}

export function PortfolioRequiredState({ area, description, onImport }: PortfolioRequiredStateProps) {
  return (
    <div className="overview-empty enter">
      <div>
        <h1 className="page-title">{area}</h1>
        <p className="page-sub">{description}</p>
      </div>
      <button className="btn btn--primary" type="button" onClick={onImport}>
        <ActionIcon name="import" />Bring in your portfolio
      </button>
    </div>
  )
}
