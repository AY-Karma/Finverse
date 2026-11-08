import { storyEditions, type StoryEdition } from '../recapSchedule'
import type { MarketBriefingStory } from '../marketBriefing'
import type { MarketEventsFeed } from '../marketEvents'
import { useStore } from '../useStore'
import { useMarketEvents } from '../useMarketEvents'
import { useStoryHistory } from './useStoryHistory'
import { useMarketBriefing } from './useMarketBriefing'

type EditionData = {
  history: ReturnType<typeof useStoryHistory>
  news: ReturnType<typeof useMarketBriefing>
  events: ReturnType<typeof useMarketEvents>
}

export type PreparedHighlights = Record<StoryEdition['id'], EditionData>

const NO_POSITIONS: ReturnType<typeof useStore>['positions'] = []
const NO_NEWS = { items: [] as MarketBriefingStory[], loading: false, ready: true, failed: false, retry: () => {} }
const NO_EVENTS = { feed: { events: [], issues: [], fetchedAt: 0 } as MarketEventsFeed, loading: false, ready: true, refresh: () => {} }

/** Prepare available editions outside the viewer so opening it reuses their data. */
export function usePreparedHighlights(today: string, editions = storyEditions(today)): PreparedHighlights {
  const { positions, settings } = useStore()
  const allowed = settings.allowExternalData && positions.length > 0
  const portfolio = editions[0]
  const weekly = editions.find((edition) => edition.id === 'weekly')
  const monthly = editions.find((edition) => edition.id === 'monthly')
  const historyEdition = {
    ...portfolio,
    from: editions.reduce((from, edition) => edition.from < from ? edition.from : from, portfolio.from),
    through: editions.reduce((through, edition) => edition.through > through ? edition.through : through, portfolio.through),
  }
  const history = useStoryHistory(positions, allowed && !settings.hideValues, today, historyEdition)
  const newsPositions = settings.hideValues ? NO_POSITIONS : positions
  const weeklyNews = useMarketBriefing(weekly ?? portfolio, newsPositions, allowed && !!weekly)
  const monthlyNews = useMarketBriefing(monthly ?? portfolio, newsPositions, allowed && !!monthly)
  const events = useMarketEvents(positions, allowed && !!weekly, settings.hideValues)

  return {
    portfolio: { history, news: NO_NEWS, events: NO_EVENTS },
    weekly: { history, news: weeklyNews, events },
    monthly: { history, news: monthlyNews, events: NO_EVENTS },
  }
}
