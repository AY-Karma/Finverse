import type { MfSchemeMapping, Position } from './types'
import { createSharedRequest } from './sharedRequest'

export interface FundSchemeCandidate {
  schemeCode: number
  schemeName: string
}

export interface FundSchemeReview {
  status: 'matched' | 'review' | 'unavailable'
  candidates: FundSchemeCandidate[]
  match?: FundSchemeCandidate
  reason: string
}

const MAX_SCHEME_NAME = 500
const MAX_SEARCH_RESULTS = 500
const MAX_SEARCH_BYTES = 512 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_SCHEME_NAME
}

export function isMfSchemeMapping(value: unknown): value is MfSchemeMapping {
  return record(value) && validCode(value.code) && validName(value.name)
    && (value.source === 'exact' || value.source === 'confirmed')
}

function isCandidate(value: unknown): value is FundSchemeCandidate {
  return record(value) && validCode(value.schemeCode) && validName(value.schemeName)
}

function schemeIdentity(name: string) {
  const words = name.toLowerCase()
    .replace(/\bincome\s+distribution\s+cum\s+capital\s+withdrawal\b/g, 'idcw')
    .replace(/\bpay\s+out\b/g, 'payout')
    .replace(/\bre[ -]?investment\b|\breinvest\b/g, 'reinvestment')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  const lastFund = words.lastIndexOf('fund')
  const planIndex = words.findIndex((word) => word === 'direct' || word === 'regular')
  const optionIndex = words.reduce((last, word, index) => ['growth', 'idcw', 'dividend'].includes(word) ? index : last, -1)
  const suffixStart = lastFund >= 0 ? lastFund + 1
    : Math.min(planIndex < 0 ? words.length : planIndex, optionIndex < 0 ? words.length : optionIndex)
  const has = (word: string) => words.slice(suffixStart).includes(word)
  const direct = has('direct')
  const regular = has('regular')
  const growth = has('growth')
  const idcw = has('idcw') || has('dividend')
  const payout = has('payout')
  const reinvestment = has('reinvestment')
  const modifiers = new Set(['direct', 'regular', 'growth', 'idcw', 'dividend', 'plan', 'option', 'payout', 'reinvestment'])
  return {
    fund: words.filter((word, index) => index < suffixStart || !modifiers.has(word)).join(' '),
    plan: direct ? 'direct' : regular ? 'regular' : undefined,
    option: growth ? 'growth' : idcw ? 'idcw' : undefined,
    distribution: payout ? 'payout' : reinvestment ? 'reinvestment' : undefined,
    conflicted: (direct && regular) || (growth && idcw) || (payout && reinvestment) || (growth && (payout || reinvestment)),
  }
}

/** Explicit confirmation can establish an abbreviated fund name, but cannot substitute a plan or option. */
export function canConfirmFundScheme(importedName: string, candidate: FundSchemeCandidate): boolean {
  if (!validName(importedName) || !isCandidate(candidate)) return false
  const target = schemeIdentity(importedName)
  const proposed = schemeIdentity(candidate.schemeName)
  if (target.conflicted || proposed.conflicted || !proposed.fund) return false
  return (!target.plan || target.plan === proposed.plan)
    && (!target.option || target.option === proposed.option)
    && (!target.distribution || target.distribution === proposed.distribution)
}

export function hasCompatibleFundScheme(position: Pick<Position, 'type' | 'name' | 'ticker' | 'mfScheme' | 'currency' | 'reportedCurrency'>): boolean {
  return position.type === 'mutual-fund' && isMfSchemeMapping(position.mfScheme)
    && (!position.currency || position.currency === 'INR') && !position.reportedCurrency
    && canConfirmFundScheme(position.name || position.ticker, { schemeCode: position.mfScheme.code, schemeName: position.mfScheme.name })
}

/** Automatic resolution requires a single complete identity, without fuzzy name scoring. */
export function matchFundScheme(importedName: string, matches: readonly FundSchemeCandidate[]): FundSchemeReview {
  if (!validName(importedName) || matches.length > MAX_SEARCH_RESULTS || matches.some((candidate) => !isCandidate(candidate))) {
    return { status: 'unavailable', candidates: [], reason: 'The scheme search returned invalid or too many results. Refine the name and try again.' }
  }
  const candidates = [...new Map(matches.map((candidate) => [`${candidate.schemeCode}:${candidate.schemeName}`, candidate])).values()]
  if (new Set(candidates.map((candidate) => candidate.schemeCode)).size !== candidates.length) {
    return { status: 'unavailable', candidates: [], reason: 'The provider returned conflicting names for one scheme code. Try the search again.' }
  }
  if (candidates.length === 0) {
    return { status: 'unavailable', candidates, reason: 'No provider schemes were found. Imported prices remain in use.' }
  }
  const target = schemeIdentity(importedName)
  if (target.conflicted || !target.fund || !target.plan || !target.option) {
    return { status: 'review', candidates, reason: 'The imported name needs a clear fund, Direct/Regular plan and Growth/IDCW option. Review the scheme before using NAV.' }
  }
  const sameFund = candidates.map((candidate) => ({ candidate, identity: schemeIdentity(candidate.schemeName) }))
    .filter(({ identity }) => identity.fund === target.fund)
  const compatible = sameFund.filter(({ identity }) => !identity.conflicted
    && identity.plan === target.plan && identity.option === target.option
    && identity.distribution === target.distribution)
  const incomplete = sameFund.some(({ identity }) => !identity.conflicted
    && (!identity.plan || !identity.option)
    && (!identity.plan || identity.plan === target.plan)
    && (!identity.option || identity.option === target.option))
  if (compatible.length !== 1 || incomplete) {
    return { status: 'review', candidates, reason: 'The fund, plan or option is uncertain or has multiple matches. Confirm the exact scheme; imported prices remain in use.' }
  }
  return { status: 'matched', candidates, match: compatible[0].candidate, reason: 'One complete fund, plan and option matches.' }
}

async function readSearchResults(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('Content-Length')) > MAX_SEARCH_BYTES) {
    throw new Error('Scheme search response is too large or empty.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_SEARCH_BYTES) throw new Error('Scheme search response is too large.')
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

const sharedReview = createSharedRequest<FundSchemeReview>()

export function reviewFundScheme(importedName: string, signal?: AbortSignal): Promise<FundSchemeReview> {
  signal?.throwIfAborted()
  if (!validName(importedName)) {
    return Promise.resolve({ status: 'unavailable', candidates: [], reason: 'Enter a scheme name of 500 characters or fewer.' })
  }
  const target = importedName.trim()
  return sharedReview(target.toLowerCase(), async (requestSignal) => {
    try {
      const deadline = AbortSignal.any([requestSignal, AbortSignal.timeout(10000)])
      const query = schemeIdentity(target).fund || target
      const response = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { signal: deadline })
      if (!response.ok) throw new Error('Scheme search unavailable.')
      const payload = await readSearchResults(response, deadline)
      if (!Array.isArray(payload)) throw new Error('Invalid scheme search response.')
      return matchFundScheme(target, payload)
    } catch {
      requestSignal.throwIfAborted()
      return { status: 'unavailable', candidates: [], reason: 'The scheme search could not be reached or returned unusable data. Imported prices remain in use.' }
    }
  }, signal)
}
