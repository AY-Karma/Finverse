import type { CSSProperties } from 'react'
import type { MarketStory, MarketStoryRow } from '../marketStories'
import './sectorStoryVisual.css'

export function SectorStoryVisual({ story }: { story: Pick<MarketStory, 'metricLabel' | 'metric' | 'metricAmount' | 'tone' | 'rows'> }) {
  const lead: MarketStoryRow[] = typeof story.metricAmount === 'number' && Number.isFinite(story.metricAmount) && story.metricAmount !== 0
    ? [{ label: story.metricLabel, value: story.metric, amount: story.metricAmount, tone: story.tone }]
    : []
  const sectors = [...lead, ...story.rows].filter((row) => Number.isFinite(row.amount) && row.amount !== 0).slice(0, 4)
  const maximum = Math.max(...sectors.map((row) => Math.abs(row.amount)), Number.MIN_VALUE)

  return <div className="sector-story" style={{ '--sector-count': sectors.length } as CSSProperties}>
    <ol className="sector-story-lanes">
      {sectors.map((sector, index) => {
        const length = Math.abs(sector.amount) / maximum * 48
        const style = {
          '--sector-length': `${length}%`,
          '--sector-start': `${sector.amount < 0 ? 50 - length : 50}%`,
          '--sector-delay': `${index * 90}ms`,
        } as CSSProperties
        return <li key={sector.label} className={`story-tone--${sector.tone}`} style={style}>
          <div className="sector-story-figures"><span>{sector.label}</span><strong>{sector.value}</strong></div>
          <div className="sector-story-track" aria-hidden="true">
            <span className="sector-story-zero" />
            <i className={`sector-story-bar sector-story-bar--${sector.amount < 0 ? 'negative' : 'positive'}`}><b /></i>
          </div>
        </li>
      })}
    </ol>
  </div>
}
