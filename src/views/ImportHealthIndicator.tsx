import { useId } from 'react'
import type { DitherColor } from '../components/dither-kit/palette'
import { getFolioFreshness, type ImportFreshness } from '../importFreshness'
import { useFolioReviewTime } from '../useFolioReviewTime'
import { DitherBar } from './DitherBar'
import './ImportHealthIndicator.css'

const STATUS: Record<ImportFreshness, { label: string; description: string; color: DitherColor }> = {
  healthy: { label: 'Healthy import', description: 'Imported within the last 7 days.', color: 'green' },
  aging: { label: 'Aging import', description: 'Imported over 7 days ago, up to 21 days. Consider updating your holdings.', color: 'yellow' },
  old: { label: 'Old import', description: 'Imported over 21 days ago. Import a recent holdings file.', color: 'red' },
  unknown: { label: 'Import age unavailable', description: 'The import date is unavailable.', color: 'grey' },
}

export function ImportHealthIndicator({ importedAt, reviewedAt, showLabel = false }: { importedAt: number; reviewedAt?: number; showLabel?: boolean }) {
  const descriptionId = useId()
  const now = useFolioReviewTime()
  const freshness = getFolioFreshness({ importedAt, reviewedAt }, now)
  const status = STATUS[freshness]
  const reviewed = reviewedAt != null && reviewedAt >= importedAt
  const label = reviewed ? status.label.replace('import', 'folio') : status.label
  const description = reviewed ? status.description.replace('Imported', 'Holdings confirmed unchanged') : status.description
  const visibleLabel = freshness === 'healthy' ? reviewed ? 'Recently reviewed' : 'Recent import'
    : freshness === 'aging' ? 'Review soon' : freshness === 'old' ? 'Update suggested' : 'Date unknown'

  return <span className={`import-health${showLabel ? ' import-health--label' : ''}`} data-status={freshness} role="img" tabIndex={0}
    aria-label={showLabel ? visibleLabel : label} aria-describedby={descriptionId} title={`${label}. ${description}`}>
    <DitherBar className="import-health-texture" segments={[{ value: 1, color: status.color }]} />
    {showLabel && <span className="import-health-label">{visibleLabel}</span>}
    <span className="sr-only" id={descriptionId}>{description}</span>
  </span>
}
