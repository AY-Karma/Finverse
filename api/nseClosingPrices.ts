import { readBoundedText } from './requestBudget.js'

const NSE_CLOSE_CACHE_MS = 60 * 60 * 1000
const IST_OFFSET_MS = 330 * 60 * 1000
export interface NseClose { price: number; previousClose: number | null; marketTime: string }
export interface NseCloseState {
  cache?: { expiresAt: number; prices: Map<string, NseClose> }
  pending?: Promise<Map<string, NseClose>>
}
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }

function reportCandidates(now: number): string[] {
  const ist = new Date(now + IST_OFFSET_MS)
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  const firstOffset = minutes >= 17 * 60 ? 0 : 1
  const dates: string[] = []
  for (let offset = firstOffset; offset < firstOffset + 8; offset += 1) {
    const candidate = new Date(ist)
    candidate.setUTCDate(candidate.getUTCDate() - offset)
    if (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) continue
    const yyyy = candidate.getUTCFullYear()
    const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(candidate.getUTCDate()).padStart(2, '0')
    dates.push(`${dd}${mm}${yyyy}`)
  }
  return dates
}

function parseNseDate(value: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value)
  if (!match) return null
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(match[2].toLowerCase())
  if (month < 0) return null
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function csvCells(line: string): string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
}

function parseNseReport(csv: string): Map<string, NseClose> {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const headers = csvCells(lines[0] ?? '').map((header) => header.toUpperCase())
  const symbolIndex = headers.indexOf('SYMBOL')
  const seriesIndex = headers.indexOf('SERIES')
  const dateIndex = headers.indexOf('DATE1')
  const closeIndex = headers.indexOf('CLOSE_PRICE')
  const previousIndex = headers.indexOf('PREV_CLOSE')
  if ([symbolIndex, seriesIndex, dateIndex, closeIndex, previousIndex].some((index) => index < 0)) {
    return new Map()
  }

  const prices = new Map<string, NseClose>()
  const seriesRanks = new Map<string, number>()
  for (const line of lines.slice(1)) {
    const cells = csvCells(line)
    const symbol = cells[symbolIndex]?.toUpperCase()
    if (!symbol) continue
    const seriesRank = cells[seriesIndex]?.toUpperCase() === 'EQ' ? 2 : 1
    if ((seriesRanks.get(symbol) ?? 0) >= seriesRank) continue
    const price = Number(cells[closeIndex])
    const previousClose = Number(cells[previousIndex])
    const sessionDate = parseNseDate(cells[dateIndex] ?? '')
    if (!finitePositive(price) || !sessionDate) continue
    prices.set(symbol, {
      price,
      previousClose: finitePositive(previousClose) ? previousClose : null,
      marketTime: new Date(`${sessionDate}T15:30:00+05:30`).toISOString(),
    })
    seriesRanks.set(symbol, seriesRank)
  }
  return prices
}

export async function fetchLatestNseClose(
  fetcher: typeof fetch,
  now: number,
  state: NseCloseState,
): Promise<Map<string, NseClose>> {
  if (state.cache && state.cache.expiresAt > now) return state.cache.prices
  if (state.pending) return state.pending
  const task = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4_000)
    try {
      for (const date of reportCandidates(now).slice(0, 3)) {
        if (controller.signal.aborted) break
        try {
          const response = await fetcher(
            `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${date}.csv`,
            {
              headers: { Accept: 'text/csv' },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1_200)]),
            },
          )
          if (!response.ok) continue
          const prices = parseNseReport(await readBoundedText(response, 8 * 1024 * 1024, controller.signal))
          if (prices.size === 0) continue
          state.cache = { prices, expiresAt: now + NSE_CLOSE_CACHE_MS }
          return prices
        } catch {
          continue
        }
      }
      const prices = new Map<string, NseClose>()
      state.cache = { prices, expiresAt: now + 15_000 }
      return prices
    } finally {
      clearTimeout(timeout)
    }
  })()
  state.pending = task
  try {
    return await task
  } finally {
    state.pending = undefined
  }
}

