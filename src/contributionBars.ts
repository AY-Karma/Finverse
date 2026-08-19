export type ContributionDisplay = 'price' | 'percent'

export interface ContributionBarInput {
  label: string
  dailyPriceChange: number | null
  dailyPriceChangePct: number | null
}

export interface ContributionBarItem extends ContributionBarInput {
  metric: number
  width: number
}

export interface ContributionColumns {
  tailwinds: ContributionBarItem[]
  headwinds: ContributionBarItem[]
}

/** Builds both columns from the active measure, with one shared visual scale. */
export function buildContributionColumns(items: ContributionBarInput[], display: ContributionDisplay, limit = 5): ContributionColumns {
  const rows = items.flatMap((item) => {
    const metric = display === 'price' ? item.dailyPriceChange : item.dailyPriceChangePct
    return metric != null && Number.isFinite(metric) ? [{ ...item, metric }] : []
  })
  const scale = Math.max(...rows.map((item) => Math.abs(item.metric)), 1)
  const row = (item: typeof rows[number]): ContributionBarItem => ({ ...item, width: Math.abs(item.metric) / scale * 100 })
  return {
    tailwinds: rows.filter((item) => item.metric >= 0).sort((left, right) => right.metric - left.metric).slice(0, limit).map(row),
    headwinds: rows.filter((item) => item.metric < 0).sort((left, right) => left.metric - right.metric).slice(0, limit).map(row),
  }
}
