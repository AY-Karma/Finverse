import type { LiveQuote, Position } from './types'
import { hasSupportedValuationCurrency, quoteKey } from './valuation'
import { workspaceWritesBlocked } from './workspaceStorage'
import { parseMonitorReadingState, type MonitorReadingState } from './monitorReading'

export type RuleCondition = 'price_above' | 'price_below' | 'daily_move'
export type AlertState = 'open' | 'reviewed' | 'snoozed'
export interface MonitorMetric { label: string; value: string; trend?: 'up' | 'down' | 'neutral' }
export interface MonitorAlert {
  id: string
  holding: string
  holdingId: string
  title: string
  reason: string
  evidence: string
  kind: 'price'
  time: string
  at: number
  metrics: MonitorMetric[]
  state: AlertState
  observationKey: string
  snoozedUntil?: number
}
export interface MonitorRule {
  id: string
  holding: string
  holdingId: string
  instrumentIdentity: string
  condition: RuleCondition
  threshold: number
  active: boolean
  unresolved?: boolean
}
export interface MonitorEvent {
  id: string
  holding: string
  holdingId?: string
  title: string
  date: string
  kind: 'Reminder'
  reminder: boolean
  unresolved?: boolean
}
export interface MonitorState { rules: MonitorRule[]; events: MonitorEvent[]; alerts: MonitorAlert[]; reading?: MonitorReadingState }

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

export function hasDuplicateMonitorRule(rules: MonitorRule[], candidate: Pick<MonitorRule, 'instrumentIdentity' | 'condition' | 'threshold'>, excludeId?: string): boolean {
  return rules.some((rule) => rule.id !== excludeId
    && rule.instrumentIdentity === candidate.instrumentIdentity
    && rule.condition === candidate.condition
    && rule.threshold === candidate.threshold)
}

export function sanitizeMonitorState(value: unknown): MonitorState {
  if (!record(value) || value.version !== 1) return emptyMonitorState()
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
  const rules: MonitorRule[] = []
  for (const item of Array.isArray(value.rules) ? value.rules.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.holdingId) || !text(item.instrumentIdentity) || !conditions.includes(item.condition as RuleCondition) || !finite(item.threshold) || item.threshold <= 0 || typeof item.active !== 'boolean') continue
    rules.push({ id: text(item.id), holding: text(item.holding), holdingId: text(item.holdingId), instrumentIdentity: text(item.instrumentIdentity), condition: item.condition as RuleCondition, threshold: item.threshold, active: item.active, ...(item.unresolved === true ? { unresolved: true } : {}) })
  }
  const events: MonitorEvent[] = []
  for (const item of Array.isArray(value.events) ? value.events.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.title) || !validReminderDate(text(item.date)) || typeof item.reminder !== 'boolean') continue
    events.push({ id: text(item.id), holding: text(item.holding) || 'Portfolio', holdingId: text(item.holdingId) || undefined, title: text(item.title, 160), date: text(item.date), kind: 'Reminder', reminder: item.reminder, ...(item.unresolved === true ? { unresolved: true } : {}) })
  }
  const alerts: MonitorAlert[] = []
  for (const item of Array.isArray(value.alerts) ? value.alerts.slice(0, MAX_ITEMS) : []) {
    if (!record(item) || !text(item.id) || !text(item.holdingId) || !text(item.observationKey, 2000) || !states.includes(item.state as AlertState) || !finite(item.at) || item.at <= 0 || item.at > Date.now() + 300_000 || item.kind !== 'price') continue
    const metrics: MonitorMetric[] = []
    for (const metric of Array.isArray(item.metrics) ? item.metrics.slice(0, 6) : []) {
      if (record(metric) && text(metric.label) && text(metric.value)) metrics.push({ label: text(metric.label, 80), value: text(metric.value, 100), ...(['up', 'down', 'neutral'].includes(String(metric.trend)) ? { trend: metric.trend as MonitorMetric['trend'] } : {}) })
    }
    const snoozedUntil = item.state === 'snoozed' && finite(item.snoozedUntil) && item.snoozedUntil > 0 && item.snoozedUntil <= 8_640_000_000_000_000 ? item.snoozedUntil : undefined
    alerts.push({ id: text(item.id), holding: text(item.holding), holdingId: text(item.holdingId), title: text(item.title), reason: text(item.reason), evidence: text(item.evidence, 2000), kind: 'price', state: item.state as AlertState, observationKey: text(item.observationKey, 2000), time: text(item.time, 80), at: item.at, metrics, ...(snoozedUntil !== undefined ? { snoozedUntil } : {}) })
  }
  let reading: MonitorReadingState | undefined
  if (value.reading !== undefined) {
    try { reading = parseMonitorReadingState(value.reading) } catch { /* Keep valid rules and alerts when reading preferences are malformed. */ }
  }
  return { rules: unique(rules), events: unique(events), alerts: unique(alerts), ...(reading ? { reading } : {}) }
}

export function loadMonitorState(): { state: MonitorState; error: string } {
  try {
    if (typeof localStorage === 'undefined') throw new Error('Storage unavailable')
    const raw = localStorage.getItem(MONITOR_STORAGE_KEY)
    if (!raw) return { state: emptyMonitorState(), error: '' }
    const parsed: unknown = JSON.parse(raw)
    if (!record(parsed) || parsed.version !== 1) return { state: emptyMonitorState(), error: 'Saved Monitor data could not be read. Add your watch rules again.' }
    const state = sanitizeMonitorState(parsed)
    return { state, error: parsed.reading !== undefined && !state.reading ? 'Saved reading preferences could not be read. Your watch rules and alerts were retained.' : '' }
  } catch {
    return { state: emptyMonitorState(), error: 'Monitor storage is unavailable. Changes will only last in this session.' }
  }
}

export function saveMonitorState(state: MonitorState): boolean {
  if (workspaceWritesBlocked()) return false
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
  if (!rule.active || rule.unresolved || !finite(rule.threshold) || rule.threshold <= 0) return false
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

function indexRulePositions(positions: Position[]) {
  const identities = new Map<string, Set<string>>()
  const byIdentity = new Map<string, { first: Position; byId: Map<string, Position> }>()
  for (const position of positions) {
    const key = quoteKey(position)
    const identity = holdingIdentity(position)
    const set = identities.get(key) ?? new Set<string>()
    set.add(identity)
    identities.set(key, set)
    const group = byIdentity.get(identity) ?? { first: position, byId: new Map<string, Position>() }
    if (!group.byId.has(position.id)) group.byId.set(position.id, position)
    byIdentity.set(identity, group)
  }
  return { identities, byIdentity }
}

function findRulePosition(rule: MonitorRule, index: ReturnType<typeof indexRulePositions>): Position | undefined {
  const group = index.byIdentity.get(rule.instrumentIdentity)
  const match = group?.byId.get(rule.holdingId) ?? group?.first
  return match && index.identities.get(quoteKey(match))?.size === 1 ? match : undefined
}

export function reconcileMonitorRules(rules: MonitorRule[], positions: Position[]): MonitorRule[] {
  const index = indexRulePositions(positions)
  return rules.map((rule) => {
    if (rule.unresolved) return rule
    const position = findRulePosition(rule, index)
    return position ? { ...rule, holdingId: position.id, holding: position.name || rule.holding || position.ticker } : { ...rule, unresolved: true }
  })
}

type RuleObservation = {
  state: 'Active' | 'Waiting' | 'Paused' | 'Unavailable'; quote?: LiveQuote; distance?: number; matched?: boolean
}

export function monitorRuleObservation(rule: MonitorRule, positions: Position[], quotes: Record<string, LiveQuote>, now: number, allowed: boolean): RuleObservation {
  return observeRule(rule, quotes, now, allowed, indexRulePositions(positions))
}

export function monitorRuleObservations(rules: MonitorRule[], positions: Position[], quotes: Record<string, LiveQuote>, now: number, allowed: boolean): Map<string, RuleObservation> {
  if (!rules.length) return new Map()
  const index = indexRulePositions(positions)
  return new Map(rules.map((rule) => [rule.id, observeRule(rule, quotes, now, allowed, index)]))
}

function observeRule(rule: MonitorRule, quotes: Record<string, LiveQuote>, now: number, allowed: boolean, index: ReturnType<typeof indexRulePositions>): RuleObservation {
  const position = findRulePosition(rule, index)
  if (rule.unresolved || !position || position.identityIssue || !hasSupportedValuationCurrency(position)) return { state: 'Unavailable' }
  if (!rule.active) return { state: 'Paused' }
  const quote = quotes[quoteKey(position)]
  if (!allowed || !usableQuote(quote, now) || !freshQuote(quote, now)
    || (position.type === 'mutual-fund' ? quote.source !== 'nav' : quote.source === 'nav')
    || (rule.condition === 'daily_move' && !finite(quote.changePct))) return { state: 'Waiting' }
  const distance = rule.condition === 'daily_move'
    ? Math.abs(rule.threshold - Math.abs(quote.changePct!))
    : Math.abs(rule.threshold - quote.price) / quote.price * 100
  return { state: 'Active', quote, matched: ruleMatches(rule, quote), ...(Number.isFinite(distance) ? { distance } : {}) }
}

export function resumeSnoozedAlerts(state: MonitorState, now: number): MonitorState {
  let changed = false
  const alerts = state.alerts.map((alert) => {
    if (alert.state !== 'snoozed' || alert.snoozedUntil === undefined || alert.snoozedUntil > now) return alert
    changed = true
    const { snoozedUntil: _deadline, ...rest } = alert
    return { ...rest, state: 'open' as const }
  })
  return changed ? { ...state, alerts } : state
}

export function evaluateMonitorRules(state: MonitorState, positions: Position[], quotes: Record<string, LiveQuote>, now: number, allowed: boolean): MonitorState {
  state = resumeSnoozedAlerts(state, now)
  if (!allowed) return state
  const seen = new Set(state.alerts.map((alert) => alert.observationKey))
  const added: MonitorAlert[] = []
  const index = indexRulePositions(positions)
  for (const rule of state.rules) {
    const position = findRulePosition(rule, index)
    if (!position || position.identityIssue || !hasSupportedValuationCurrency(position)) continue
    const quote = quotes[quoteKey(position)]
    if (!usableQuote(quote, now) || !freshQuote(quote, now) || !ruleMatches(rule, quote)
      || (position.type === 'mutual-fund' ? quote.source !== 'nav' : quote.source === 'nav')) continue
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
