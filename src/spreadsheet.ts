import * as XLSX from 'xlsx'
import type { AssetType, Position } from './types'

interface RawRow {
  [header: string]: unknown
}

const HEADER_ALIASES: Record<string, string[]> = {
  ticker: ['ticker', 'symbol', 'code', 'script', 'isin', 'name'],
  quantity: ['quantity', 'qty', 'units', 'shares', 'noofunits', 'no of units', 'held'],
  buyPrice: ['buyprice', 'buy price', 'price', 'avgcost', 'averagecost', 'avgprice', 'nav', 'cost'],
  lastPrice: ['lastprice', 'last price', 'lasttradedprice', 'ltp', 'currentprice', 'marketprice', 'close'],
  name: ['company', 'securityname', 'fund', 'fundname', 'scheme', 'description'],
  type: ['type', 'assettype', 'assetclass', 'class', 'instrument', 'category'],
}

function findHeader(row: RawRow, key: keyof typeof HEADER_ALIASES): string | null {
  const present = Object.keys(row).filter((k) => k.trim() !== '')
  for (const header of present) {
    const norm = header.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (HEADER_ALIASES[key].some((alias) => alias.replace(/[^a-z]/g, '') === norm)) {
      return header
    }
  }
  return null
}

function parseNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function inferType(v: unknown): AssetType {
  if (v == null) return 'other'
  const s = String(v).toLowerCase()
  if (s.includes('mutual') || s.includes('fund') || s.includes('mf')) return 'mutual-fund'
  if (s.includes('etf')) return 'etf'
  if (s.includes('stock') || s.includes('equity') || s.includes('share')) return 'stock'
  return 'other'
}

export function parseSpreadsheet(file: ArrayBuffer): Position[] {
  const wb = XLSX.read(file, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null })

  const positions: Position[] = []
  for (const row of rows) {
    const ticker = row[findHeader(row, 'ticker') ?? ''] ?? null
    if (ticker == null || String(ticker).trim() === '') continue

    const qtyRaw = parseNumber(row[findHeader(row, 'quantity') ?? ''] ?? null)
    const buyRaw = parseNumber(row[findHeader(row, 'buyPrice') ?? ''] ?? null)
    const lastHeader = findHeader(row, 'lastPrice')
    const lastRaw = lastHeader ? parseNumber(row[lastHeader]) : null

    positions.push({
      id: crypto.randomUUID(),
      ticker: String(ticker).trim().toUpperCase(),
      name: String(row[findHeader(row, 'name') ?? ''] ?? '').trim(),
      type: inferType(row[findHeader(row, 'type') ?? ''] ?? null),
      quantity: qtyRaw ?? 0,
      buyPrice: buyRaw ?? 0,
      lastPrice: lastRaw,
      invested: (qtyRaw ?? 0) * (buyRaw ?? 0),
    })
  }

  return positions
}