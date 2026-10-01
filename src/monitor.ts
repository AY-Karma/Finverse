import type { LiveQuote, Position } from './types'
import { quoteKey } from './valuation'

export type RuleCondition = 'price_above' | 'price_below' | 'daily_move'
export type AlertState = 'open' | 'reviewed' | 'snoozed'
export interface MonitorMetric { label: string; value: string; trend?: 'up' | 'down' | 'neutral' }
export interface MonitorRecord {
  id: string
  holding: string
  holdingId: string
  title: string
  reason: string
  evidence: string
  kind: 'quote'
  time: string
  at: number
  metrics: MonitorMetric[]
}
export interface MonitorAlert extends Omit<MonitorRecord, 'kind'> {
  kind: 'price'
  state: AlertState
  observationKey: string
}
export interface MonitorRule {
  id: string
  holding: string
  holdingId: string
  instrumentIdentity: string
  condition: RuleCondition
  threshold: number
  active: boolean
}
export interface MonitorEvent {
  id: string
  holding: string
  holdingId?: string
  title: string
  date: string
  kind: 'Reminder'
  reminder: boolean
}
export interface MonitorState { rules: MonitorRule[]; events: MonitorEvent[]; alerts: MonitorAlert[] }

export const MONITOR_STORAGE_KEY = 'finverse:monitor:v1'
export const emptyMonitorState = (): MonitorState => ({ rules: [], events: [], alerts: [] })
const DAY = 86_400_000
const MAX_ITEMS = 200
const sourceLabels: Record<LiveQuote['source'], string> = { yahoo: 'Yahoo Finance', 'nse-close': 'NSE close', nav: 'Published NAV' }
const conditions: RuleCondition[] = ['price_above', 'price_below', 'daily_move']
const states: AlertState[] = ['open', 'reviewed', 'snoozed']
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const hasOwn = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key)

export function validReminderDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}

export function holdingIdentity(position: Position): string {
  return [quoteKey(position), position.type, position.exchange ?? '', position.currency ?? '', position.providerSymbol ?? '', position.isin ?? ''].join('|')
}

export function sanitizeMonitorState(value: unknown): MonitorState {
  if (!record(value) || value.version !== 1) return emptyMonitorState()
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
  const rules: MonitorRule[] = []
  for (const item of Array.isArray(value.rules) ? value.rules.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.holdingId) || !text(item.instrumentIdentity) || !conditions.includes(item.condition as RuleCondition) || !finite(item.threshold) || item.threshold <= 0 || typeof item.active !== 'boolean') continue
    rules.push({ id: text(item.id), holding: text(item.holding), holdingId: text(item.holdingId), instrumentIdentity: text(item.instrumentIdentity), condition: item.condition as RuleCondition, threshold: item.threshold, active: item.active })
  }
  const events: MonitorEvent[] = []
  for (const item of Array.isArray(value.events) ? value.events.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.title) || !validReminderDate(text(item.date)) || typeof item.reminder !== 'boolean') continue
    events.push({ id: text(item.id), holding: text(item.holding) || 'Portfolio', holdingId: text(item.holdingId) || undefined, title: text(item.title, 160), date: text(item.date), kind: 'Reminder', reminder: item.reminder })
  }
  const alerts: MonitorAlert[] = []
  for (const item of Array.isArray(value.alerts) ? value.alerts.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.holdingId) || !text(item.observationKey, 2000) || !states.includes(item.state as AlertState) || !finite(item.at) || item.at <= 0 || item.at > Date.now() + 300_000 || item.kind !== 'price') continue
    const metrics: MonitorMetric[] = []
    for (const metric of Array.isArray(item.metrics) ? item.metrics.slice(0, 6) : []) {
      if (record(metric) && text(metric.label) && text(metric.value)) metrics.push({ label: text(metric.label, 80), value: text(metric.value, 100), ...(['up', 'down', 'neutral'].includes(String(metric.trend)) ? { trend: metric.trend as MonitorMetric['trend'] } : {}) })
    }
    alerts.push({ id: text(item.id), holding: text(item.holding), holdingId: text(item.holdingId), title: text(item.title), reason: text(item.reason), evidence: text(item.evidence, 2000), kind: 'price', state: item.state as AlertState, observationKey: text(item.observationKey, 2000), time: text(item.time, 80), at: item.at, metrics })
  }
  return { rules: unique(rules), events: unique(events), alerts: unique(alerts) }
}

export function loadMonitorState(): { state: MonitorState; error: string } {
  try {
    if (typeof localStorage === 'undefined') throw new Error('Storage unavailable')
    const raw = localStorage.getItem(MONITOR_STORAGE_KEY)
    if (!raw) return { state: emptyMonitorState(), error: '' }
    const parsed: unknown = JSON.parse(raw)
    if (!record(parsed) || parsed.version !== 1) return { state: emptyMonitorState(), error: 'Saved Monitor data could not be read. Add your watch rules again.' }
    return { state: sanitizeMonitorState(parsed), error: '' }
  } catch {
    return { state: emptyMonitorState(), error: 'Monitor storage is unavailable. Changes will only last in this session.' }
  }
}

export function saveMonitorState(state: MonitorState): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, ...state }))
    return true
  } catch { return false }
}

export function usableQuote(quote: LiveQuote | undefined, now: number): quote is LiveQuote {
  return !!quote && finite(quote.price) && quote.price > 0 && finite(quote.at) && quote.at > 0 && quote.at <= now + 300_000 && hasOwn(sourceLabels, quote.source)
}

export function freshQuote(quote: LiveQuote, now: number): boolean {
  return now - quote.at <= (quote.source === 'nav' ? 4 * DAY : 1.5 * DAY)
}

export function ruleMatches(rule: MonitorRule, quote: LiveQuote): boolean {
  if (!rule.active || !finite(rule.threshold) || rule.threshold <= 0) return false
  if (rule.condition === 'price_above') return quote.price > rule.threshold
  if (rule.condition === 'price_below') return quote.price < rule.threshold
  return finite(quote.changePct) && Math.abs(quote.changePct) > rule.threshold
}

function amount(value: number, position: Position): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: position.currency ?? 'INR', maximumFractionDigits: 2 }).format(value)
}
function time(at: number): string { return new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }
function label(position: Position): string { return position.name || position.ticker }
function quoteMetrics(position: Position, quote: LiveQuote): MonitorMetric[] {
  const metrics: MonitorMetric[] = [{ label: quote.source === 'nav' ? 'Published NAV' : 'Latest price', value: amount(quote.price, position) }]
  const changePct = quote.changePct
  if (finite(changePct)) metrics.push({ label: 'Day move', value: `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`, trend: changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'neutral' })
  return metrics
}

function quoteIdentities(positions: Position[]): Map<string, Set<string>> {
  const identities = new Map<string, Set<string>>()
  for (const position of positions) {
    const key = quoteKey(position)
    const set = identities.get(key) ?? new Set<string>()
    set.add(holdingIdentity(position))
    identities.set(key, set)
  }
  return identities
}

function findRulePosition(rule: MonitorRule, positions: Position[], identities: Map<string, Set<string>>): Position | undefined {
  const match = positions.find((position) => position.id === rule.holdingId && holdingIdentity(position) === rule.instrumentIdentity)
    ?? positions.find((position) => holdingIdentity(position) === rule.instrumentIdentity)
  return match && identities.get(quoteKey(match))?.size === 1 ? match : undefined
}

export function reconcileMonitorRules(rules: MonitorRule[], positions: Position[]): MonitorRule[] {
  const identities = quoteIdentities(positions)
  return rules.flatMap((rule) => {
    const position = findRulePosition(rule, positions, identities)
    return position ? [{ ...rule, holdingId: position.id, holding: position.name || rule.holding || position.ticker }] : []
  })
}

export function evaluateMonitorRules(state: MonitorState, positions: Position[], quotes: Record<string, LiveQuote>, now: number, allowed: boolean): MonitorState {
  if (!allowed) return state
  const seen = new Set(state.alerts.map((alert) => alert.observationKey))
  const added: MonitorAlert[] = []
  const identities = quoteIdentities(positions)
  for (const rule of state.rules) {
    const position = findRulePosition(rule, positions, identities)
    if (!position) continue
    const quote = quotes[quoteKey(position)]
    if (!usableQuote(quote, now) || !freshQuote(quote, now) || !ruleMatches(rule, quote)) continue
    const providerDay = new Date(quote.at).toISOString().slice(0, 10)
    const observationKey = [rule.id, rule.instrumentIdentity, rule.condition, rule.threshold, providerDay].join('|')
    if (seen.has(observationKey)) continue
    seen.add(observationKey)
    const condition = rule.condition === 'daily_move' ? 'Daily move exceeds your threshold' : `Price is ${rule.condition === 'price_above' ? 'above' : 'below'} your level`
    const level = rule.condition === 'daily_move' ? `${rule.threshold}%` : amount(rule.threshold, position)
    const changePct = quote.changePct
    const hasMove = finite(changePct)
    const move = hasMove ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : ''
    const title = rule.condition === 'daily_move' && hasMove
      ? `Daily move ${changePct > 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(2)}%`
      : condition
    const evidence = `${sourceLabels[quote.source]} · ${new Date(quote.at).toLocaleString('en-IN')}. Observed price ${amount(quote.price, position)}.${move ? ` Day move ${move}.` : ''} Watch level ${level}. This is a condition match, not a recorded threshold crossing.`
    added.push({ id: crypto.randomUUID(), holding: label(position), holdingId: position.id, title, reason: `The latest provider observation meets your ${level} watch condition.`, evidence, kind: 'price', state: 'open', observationKey, time: time(quote.at), at: quote.at, metrics: [...quoteMetrics(position, quote), { label: 'Watch level', value: level }] })
  }
  return added.length ? { ...state, alerts: [...added.reverse(), ...state.alerts].slice(0, MAX_ITEMS) } : state
}

export function latestQuoteRecords(positions: Position[], quotes: Record<string, LiveQuote>, now: number, allowed: boolean): MonitorRecord[] {
  if (!allowed) return []
  const identities = quoteIdentities(positions)
  return positions.flatMap((position): MonitorRecord[] => {
    const quote = quotes[quoteKey(position)]
    if (identities.get(quoteKey(position))?.size !== 1 || !usableQuote(quote, now)) return []
    const fresh = freshQuote(quote, now)
    return [{ id: `quote:${position.id}`, holding: label(position), holdingId: position.id, title: quote.source === 'nav' ? 'Latest published NAV' : 'Latest available quote', reason: `${sourceLabels[quote.source]}${fresh ? '' : ' · older observation; watch rules are waiting for fresh data'}`, evidence: `Provider observation: ${new Date(quote.at).toLocaleString('en-IN')}. ${sourceLabels[quote.source]}. This card shows the latest available observation, not a new event or price history.`, kind: 'quote', at: quote.at, time: time(quote.at), metrics: quoteMetrics(position, quote) }]
  }).sort((a, b) => b.at - a.at)
}
