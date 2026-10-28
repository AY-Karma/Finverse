import { MAX_EVENT_SYMBOLS, isEventDate, isEventSymbol, isOfficialEventUrl, type MarketEventPayload, type MarketEventIssue } from '../src/marketEventsProtocol.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'

const DAY_MS = 86_400_000
const IST_OFFSET_MS = 19_800_000
const CACHE_MS = 5 * 60_000
const PARTIAL_CACHE_MS = 15_000
const EQUITY_MASTER_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
type Row = Record<string, unknown>
type FeedKind = 'calendar' | 'actions' | 'filings'
interface Dependencies { fetcher: typeof fetch; now: () => number }

function dateAt(timestamp: number): string { return new Date(timestamp + IST_OFFSET_MS).toISOString().slice(0, 10) }
function queryDate(value: string): string { return value.split('-').reverse().join('-') }
function text(value: unknown, maximum = 500): string { return typeof value === 'string' ? value.trim().slice(0, maximum) : '' }

function equityReference(csv: string): Record<string, string> {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closedQuote = false
  const endField = () => { row.push(field.trim()); field = ''; closedQuote = false }
  const endRow = () => {
    endField()
    if (row.some(Boolean)) rows.push(row)
    row = []
    if (rows.length > 10_000) throw new Error('Equity reference is too large')
  }
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character !== '"') field += character
      else if (csv[index + 1] === '"') { field += '"'; index += 1 }
      else { quoted = false; closedQuote = true }
    } else if (character === ',') endField()
    else if (character === '\r' || character === '\n') {
      endRow()
      if (character === '\r' && csv[index + 1] === '\n') index += 1
    } else if (character === '"') {
      if (field.trim() || closedQuote) throw new Error('Invalid equity reference CSV')
      field = ''; quoted = true
    } else if (closedQuote) {
      if (character.trim()) throw new Error('Invalid equity reference CSV')
    } else field += character
  }
  if (quoted) throw new Error('Invalid equity reference CSV')
  if (field || row.length) endRow()
  const header = rows.shift()?.map((value) => value.replace(/^\uFEFF/, '').trim().toUpperCase()) ?? []
  const required = ['SYMBOL', 'SERIES', 'ISIN NUMBER']
  if (required.some((name) => header.filter((column) => column === name).length !== 1)) throw new Error('Equity reference columns changed')
  const [symbolColumn, seriesColumn, isinColumn] = required.map((name) => header.indexOf(name))
  const identities = new Map<string, Set<string>>()
  for (const values of rows) {
    if (values.length !== header.length) throw new Error('Invalid equity reference row')
    const symbol = values[symbolColumn], series = values[seriesColumn], isin = values[isinColumn]
    if (!['EQ', 'BE'].includes(series) || !isEventSymbol(symbol) || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) continue
    const known = identities.get(symbol) ?? new Set<string>()
    known.add(isin)
    identities.set(symbol, known)
  }
  return Object.fromEntries([...identities].filter(([, isins]) => isins.size === 1).map(([symbol, isins]) => [symbol, [...isins][0]]))
}

function nseDate(value: unknown): string | null {
  const match = text(value).match(/^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s|$)/)
  if (!match) return null
  const month = MONTHS.findIndex((candidate) => candidate.toLowerCase() === match[2].toLowerCase()) + 1
  const result = `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`
  return month > 0 && isEventDate(result) ? result : null
}

function publishedTime(value: unknown): number | undefined {
  const date = nseDate(value)
  const time = text(value).match(/\s(\d{2}:\d{2}:\d{2})$/)?.[1]
  if (!date || !time || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return undefined
  const parsed = Date.parse(`${date}T${time}+05:30`)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseRow(row: Row, feed: FeedKind, from: string, to: string, now: number): MarketEventPayload | null {
  const symbol = text(row.symbol, 30)
  const date = nseDate(feed === 'calendar' ? row.date : feed === 'actions' ? row.exDate : row.an_dt)
  const title = text(feed === 'calendar' ? row.purpose : feed === 'actions' ? row.subject : row.desc)
  if (!isEventSymbol(symbol) || !date || date < from || date > to || !title) return null
  if (feed === 'actions' && row.series !== 'EQ' && row.series !== 'BE') return null
  const isin = text(feed === 'actions' ? row.isin : row.sm_isin, 12)
  if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return null
  const sourceUrl = feed === 'calendar'
    ? 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings'
    : feed === 'actions' ? 'https://www.nseindia.com/companies-listing/corporate-filings-actions' : text(row.attchmntFile, 2000)
  if (!isOfficialEventUrl(sourceUrl)) return null
  const publishedAt = feed === 'filings' ? publishedTime(row.an_dt) : undefined
  if (feed === 'filings' && (!publishedAt || publishedAt > now + 300_000)) return null
  return {
    id: `${feed}:${symbol}:${date}:${feed === 'filings' ? text(row.seq_id, 100) || sourceUrl : title}`,
    symbol, ...(isin ? { isin } : {}), title,
    kind: feed === 'calendar' ? /financial results/i.test(title) ? 'results' : 'meeting'
      : feed === 'actions' ? /dividend/i.test(title) ? 'dividend' : 'corporate-action' : 'filing',
    date, dateLabel: feed === 'calendar' ? 'Meeting date' : feed === 'actions' ? 'Ex-date' : 'Published',
    ...(publishedAt ? { publishedAt } : {}), sourceUrl, source: 'NSE',
  }
}

export function createEventsHandler(dependencies: Partial<Dependencies> = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  const sourceBudget = createRequestBudget(now)

  const loadEquityReference = () => sourceBudget(EQUITY_MASTER_URL, CACHE_MS, async (signal) => {
    try {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(4_000)])
      const response = await fetcher(EQUITY_MASTER_URL, { signal: deadline })
      if (!response.ok) throw new Error('Equity reference unavailable')
      return Response.json(equityReference(await readBoundedText(response, 2 * 1024 * 1024, deadline)))
    } catch { return Response.json({ error: 'Equity reference unavailable.' }, { status: 502 }) }
  })

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: HEADERS })
    const params = new URL(request.url).searchParams
    const symbols = params.get('symbols')?.split(',').map((value) => value.trim().toUpperCase()) ?? []
    if (!symbols.length || symbols.length > MAX_EVENT_SYMBOLS || symbols.some((value) => !isEventSymbol(value)) || [...params.keys()].some((key) => key !== 'symbols')) {
      return Response.json({ error: `Provide up to ${MAX_EVENT_SYMBOLS} NSE equity symbols.` }, { status: 400, headers: HEADERS })
    }
    const selected = new Set(symbols)
    const today = dateAt(now())
    const until = dateAt(now() + 90 * DAY_MS)
    const since = dateAt(now() - 7 * DAY_MS)
    let cacheTtl = CACHE_MS
    return budget([...selected].sort().join(','), () => cacheTtl, async () => {
      const sources: { kind: FeedKind; label: string; path: string; from: string; to: string }[] = [
        { kind: 'calendar', label: 'NSE meetings', path: '/api/event-calendar', from: today, to: until },
        { kind: 'actions', label: 'NSE corporate actions', path: `/api/corporates-corporateActions?index=equities&from_date=${queryDate(today)}&to_date=${queryDate(until)}`, from: today, to: until },
        { kind: 'filings', label: 'NSE filings', path: `/api/corporate-announcements?index=equities&from_date=${queryDate(since)}&to_date=${queryDate(today)}`, from: since, to: today },
      ]
      const feedsTask = Promise.all(sources.map(async (source) => {
        const response = await sourceBudget(source.path, CACHE_MS, async (signal) => {
          try {
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(4_000)])
            const upstream = await fetcher(`https://www.nseindia.com${source.path}`, { signal: deadline })
            if (!upstream.ok) throw new Error('Source unavailable')
            const body = await readBoundedText(upstream, 6 * 1024 * 1024, deadline)
            const rows: unknown = JSON.parse(body)
            if (!Array.isArray(rows) || rows.length > 10_000 || rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) throw new Error('Source format changed')
            return Response.json(rows)
          } catch { return Response.json({ error: 'Source unavailable.' }, { status: 502 }) }
        })
        if (!response.ok) return { events: [], issue: { source: source.label, message: 'Source unavailable. Open NSE to verify its latest updates.' } }
        const rows = await response.json() as Row[]
        const events = rows.filter((row) => selected.has(text(row.symbol, 30))).map((row) => parseRow(row, source.kind, source.from, source.to, now())).filter((event): event is MarketEventPayload => event !== null)
        return { events, issue: null }
      }))
      const referenceResponse = await loadEquityReference()
      const reference: Record<string, string> = referenceResponse.ok ? await referenceResponse.json() : {}
      const feeds = await feedsTask
      const issues = feeds.flatMap((feed) => feed.issue ? [feed.issue] : []) as MarketEventIssue[]
      const unverified = new Set<string>()
      const verifiedEvents = feeds.flatMap((feed) => feed.events).map((event) => {
        if (event.kind !== 'filing') return event
        const issuerIsin = reference[event.symbol]
        if (!issuerIsin) { unverified.add(event.symbol); return event }
        return { ...event, issuerIsin }
      })
      if (unverified.size) issues.push({ source: 'NSE issuer reference', message: referenceResponse.ok
        ? `Current equity identity could not be verified for ${[...unverified].sort().join(', ')}. Some filings may be withheld.`
        : 'The current NSE equity reference is unavailable. Some company filings may be withheld.' })
      const unique = new Map(verifiedEvents.map((event) => [event.id, event]))
      const events = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1000)
      if (issues.length) cacheTtl = PARTIAL_CACHE_MS
      return Response.json({ events, issues, fetchedAt: now() }, { status: feeds.every((feed) => feed.issue) ? 502 : 200, headers: HEADERS })
    })
  }
}

export const handleEventsRequest = createEventsHandler()
export default { fetch: handleEventsRequest }
