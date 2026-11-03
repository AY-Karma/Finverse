import * as XLSX from '@e965/xlsx'
import { AMFI_CLASSIFICATION_PAGE, MARKET_CAP_REFERENCE_TTL, isAmfiClassificationUrl, type MarketCapReference } from '../src/marketCapProtocol.js'
import type { MarketCapRecord } from '../src/marketCapExposure.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'

const HEADERS = { 'Cache-Control': 'public, max-age=21600, stale-while-revalidate=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const MAX_FILE_BYTES = 5 * 1024 * 1024

function latestSource(html: string, now: number): { url: string; asOf: string } {
  const today = new Date(now + 330 * 60_000).toISOString().slice(0, 10)
  const candidates = [...html.matchAll(/href=["']([^"']+\.xlsx\s*)["']/gi)].flatMap((match) => {
    const url = match[1].trim()
    if (!isAmfiClassificationUrl(url)) return []
    const date = decodeURIComponent(new URL(url).pathname).match(/(30Jun(?:e)?|31Dec)[ _-]?(\d{4})/i)
    if (!date) return []
    const asOf = `${date[2]}-${date[1].toLowerCase().startsWith('30jun') ? '06-30' : '12-31'}`
    return asOf <= today ? [{ url, asOf }] : []
  }).sort((left, right) => right.asOf.localeCompare(left.asOf))
  if (!candidates.length) throw new Error('AMFI classification links are unavailable.')
  return candidates[0]
}

async function readWorkbook(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('AMFI workbook unavailable or too large.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_FILE_BYTES) throw new Error('AMFI workbook is too large.')
      chunks.push(chunk.value)
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function parseWorkbook(bytes: Uint8Array, source: { url: string; asOf: string }): MarketCapReference {
  const workbook = XLSX.read(bytes, { type: 'array', sheetRows: 20_002, sheets: 0 })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('AMFI classification sheet is unavailable.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
  const expectedTitleDate = `${source.asOf.endsWith('06-30') ? '30 June' : '31 December'} ${source.asOf.slice(0, 4)}`
  if (!rows.slice(0, 5).some((row) => row.some((cell) => String(cell).includes(expectedTitleDate)))) throw new Error('AMFI workbook reporting date changed.')
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim().toUpperCase() === 'ISIN'))
  if (headerIndex < 0 || headerIndex > 5) throw new Error('AMFI classification columns changed.')
  const header = rows[headerIndex].map((cell) => String(cell).trim())
  const isinColumn = header.findIndex((cell) => cell.toUpperCase() === 'ISIN')
  const nameColumn = header.findIndex((cell) => /^company name$/i.test(cell))
  const bandColumn = header.findIndex((cell) => /categorization.*SEBI/i.test(cell))
  if (nameColumn < 0 || bandColumn < 0) throw new Error('AMFI classification columns changed.')
  const records: MarketCapRecord[] = []
  const seen = new Set<string>()
  for (const row of rows.slice(headerIndex + 1)) {
    if (!Number.isInteger(Number(row[0])) || Number(row[0]) <= 0) continue
    const isin = String(row[isinColumn]).trim().toUpperCase()
    const name = String(row[nameColumn]).trim()
    const classification = String(row[bandColumn]).trim().toLowerCase().replace(/\s+/g, ' ')
    const band = classification === 'large cap' ? 'large' : classification === 'mid cap' ? 'mid' : classification === 'small cap' ? 'small' : null
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin) || !name || name.length > 500 || !band || seen.has(isin)) throw new Error('AMFI classification rows changed.')
    seen.add(isin)
    records.push({ asOf: source.asOf, isin, name, band, weight: 100, parentIsin: '', source: source.url })
  }
  if (records.length < 250 || records.length > 20_000) throw new Error('AMFI classification list is incomplete.')
  return { asOf: source.asOf, sourceUrl: source.url, records }
}

export function createMarketCapHandler(dependencies: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...HEADERS, 'Cache-Control': 'no-store' } })
    if (new URL(request.url).search) return Response.json({ error: 'This reference endpoint does not accept parameters.' }, { status: 400, headers: { ...HEADERS, 'Cache-Control': 'no-store' } })
    return budget('amfi-classifications', MARKET_CAP_REFERENCE_TTL, async (signal) => {
      try {
        const response = await fetcher(AMFI_CLASSIFICATION_PAGE, { signal, redirect: 'error' })
        if (!response.ok) throw new Error('AMFI is unavailable.')
        const source = latestSource(await readBoundedText(response, 1_000_000, signal), now())
        const file = await fetcher(source.url, { signal, redirect: 'error' })
        if (!file.ok) throw new Error('AMFI workbook is unavailable.')
        const reference = parseWorkbook(await readWorkbook(file, signal), source)
        return Response.json(reference, { headers: HEADERS })
      } catch { return Response.json({ error: 'AMFI classifications are temporarily unavailable.' }, { status: 502, headers: { ...HEADERS, 'Cache-Control': 'no-store' } }) }
    })
  }
}

export const handleMarketCapRequest = createMarketCapHandler()
export default { fetch: handleMarketCapRequest }
