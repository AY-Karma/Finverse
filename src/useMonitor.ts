import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from './useStore'
import { privateValue } from './privacy'
import {
  evaluateMonitorRules, hasDuplicateMonitorRule, holdingIdentity, latestQuoteRecords, loadMonitorState, reconcileMonitorRules, saveMonitorState, validReminderDate,
  type AlertState, type MonitorAlert, type MonitorRecord, type RuleCondition,
} from './monitor'

function today(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function useMonitor() {
  const { positions, liveQuotes, settings, refreshNow, marketDataRefreshing, marketDataResult } = useStore()
  const [loaded] = useState(loadMonitorState)
  const [state, setState] = useState(loaded.state)
  const [status, setStatus] = useState(() => ({ message: settings.allowExternalData ? '' : 'External market data is off. Enable it in Settings to load quote updates.', revision: 0 }))
  const [storageError, setStorageError] = useState(loaded.error)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now)

  const setStatusMessage = useCallback((message: string) => {
    setStatus((current) => ({ message, revision: current.revision + 1 }))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const rules = useMemo(() => reconcileMonitorRules(state.rules, positions), [state.rules, positions])

  useEffect(() => {
    if (rules.length === state.rules.length && rules.every((rule, index) => {
      const current = state.rules[index]
      return current && rule.id === current.id && rule.holdingId === current.holdingId && rule.holding === current.holding
    })) return
    setState((current) => ({ ...current, rules: reconcileMonitorRules(current.rules, positions) }))
  }, [rules, state.rules, positions])

  useEffect(() => {
    setState((current) => evaluateMonitorRules(current, positions, liveQuotes, now, settings.allowExternalData))
  }, [positions, liveQuotes, rules, now, settings.allowExternalData])

  useEffect(() => {
    if (!saveMonitorState(state)) setStorageError('Monitor changes could not be saved. They will only last in this session.')
    else if (!loaded.error) setStorageError('')
  }, [state, loaded.error])

  function saveRule(input: { id?: string; holdingId: string; condition: RuleCondition; threshold: number }): boolean {
    const position = positions.find((item) => item.id === input.holdingId)
    const existing = input.id ? state.rules.find((rule) => rule.id === input.id) : undefined
    if (!position || !['price_above', 'price_below', 'daily_move'].includes(input.condition) || !Number.isFinite(input.threshold) || input.threshold <= 0 || (input.id && !existing)) {
      setStatusMessage('Choose a current holding and enter a positive, finite watch level.')
      return false
    }
    const rule = {
      id: input.id ?? crypto.randomUUID(),
      holdingId: position.id,
      holding: position.name || position.ticker || existing?.holding || 'Holding',
      instrumentIdentity: holdingIdentity(position),
      condition: input.condition,
      threshold: input.threshold,
      active: existing?.active ?? true,
    }
    if (hasDuplicateMonitorRule(state.rules, rule, input.id)) {
      setStatusMessage('A watch rule with this holding, condition, and level already exists. Edit the existing rule instead.')
      return false
    }
    if (!input.id && state.rules.length >= 200) {
      setStatusMessage('You can save up to 200 watch rules. Remove one before adding another.')
      return false
    }
    setState((current) => ({ ...current, rules: input.id ? current.rules.map((item) => item.id === input.id ? rule : item) : [...current.rules, rule] }))
    setStatusMessage('Watch rule saved.')
    return true
  }

  function addReminder(input: { holdingId: string | null; title: string; date: string }): boolean {
    const position = input.holdingId ? positions.find((item) => item.id === input.holdingId) : undefined
    if ((input.holdingId && !position) || !input.title.trim() || !validReminderDate(input.date) || input.date < today(Date.now())) {
      setStatusMessage('Enter a reminder title, a current holding, and a date from today onwards.')
      return false
    }
    if (state.events.length >= 200) {
      setStatusMessage('You can save up to 200 reminders.')
      return false
    }
    const reminder = {
      id: crypto.randomUUID(),
      holding: position?.name || position?.ticker || 'Portfolio',
      holdingId: position?.id,
      title: input.title.trim().slice(0, 160),
      date: input.date,
      kind: 'Reminder' as const,
      reminder: true,
    }
    setState((current) => ({ ...current, events: [...current.events, reminder] }))
    setStatusMessage('Reminder added to your timeline. It is shown in this app; no notification is scheduled.')
    return true
  }

  function setAlertState(id: string, alertState: AlertState) {
    if (!['open', 'reviewed', 'snoozed'].includes(alertState)) return
    setState((current) => ({ ...current, alerts: current.alerts.map((alert) => alert.id === id ? { ...alert, state: alertState } : alert) }))
    setStatusMessage(alertState === 'open' ? 'Alert reopened.' : alertState === 'reviewed' ? 'Alert marked reviewed.' : 'Alert moved to snoozed. Reopen it when you are ready.')
  }

  function toggleRule(id: string) {
    setState((current) => ({ ...current, rules: current.rules.map((rule) => rule.id === id ? { ...rule, active: !rule.active } : rule) }))
    setStatusMessage('Watch rule updated.')
  }

  function deleteRule(id: string) {
    setState((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }))
    setStatusMessage('Watch rule removed. Previous observations remain in your history.')
  }

  function toggleReminder(id: string) {
    setState((current) => ({ ...current, events: current.events.map((event) => event.id === id ? { ...event, reminder: !event.reminder } : event) }))
    setStatusMessage('Reminder updated.')
  }

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await refreshNow()
      setNow(Date.now())
      setStatusMessage(result.ok
        ? 'Latest available prices requested. Watch rules use provider observation times.'
        : result.reason === 'disabled'
          ? 'Enable external market data in Settings to refresh prices.'
          : result.reason === 'cooldown'
            ? `Prices were recently refreshed. Try again in ${Math.ceil(result.retryInMs / 1000)} seconds.`
            : 'Prices could not be refreshed. Your previous observations remain available.')
    } catch {
      setStatusMessage('Prices could not be refreshed. Try again shortly.')
    } finally { setRefreshing(false) }
  }, [refreshNow])

  useEffect(() => {
    if (!settings.allowExternalData) return
    if (marketDataResult?.failed && !marketDataResult.updated) setStatusMessage('Latest quotes could not be reached. Showing previous provider observations where available.')
  }, [marketDataResult, settings.allowExternalData])

  const redact = <T extends MonitorRecord | MonitorAlert>(item: T): T => !settings.hideValues ? item : ({
    ...item,
    title: item.kind === 'price' ? 'Watch observation hidden' : item.title,
    reason: 'Values are hidden.',
    evidence: 'Provider observation details are hidden while Hide values is enabled.',
    metrics: item.metrics.map((metric) => ({ ...metric, value: privateValue(metric.value, true), trend: 'neutral' })),
  })
  const quoteRecords = useMemo(() => latestQuoteRecords(positions, liveQuotes, now, settings.allowExternalData), [positions, liveQuotes, now, settings.allowExternalData])
  const currentDate = today(now)
  return {
    positions,
    hideValues: settings.hideValues,
    allowExternalData: settings.allowExternalData,
    alerts: state.alerts.map(redact),
    quoteRecords: quoteRecords.map(redact),
    rules,
    events: [...state.events].sort((a, b) => a.date.localeCompare(b.date)),
    counts: {
      open: state.alerts.filter((alert) => alert.state === 'open').length,
      reviewed: state.alerts.filter((alert) => alert.state === 'reviewed').length,
      snoozed: state.alerts.filter((alert) => alert.state === 'snoozed').length,
      activeRules: rules.filter((rule) => rule.active).length,
      upcoming: state.events.filter((event) => event.reminder && event.date >= currentDate).length,
    },
    statusMessage: storageError || status.message,
    statusRevision: status.revision,
    refreshing: refreshing || marketDataRefreshing,
    refresh,
    setAlertState,
    saveRule,
    toggleRule,
    deleteRule,
    addReminder,
    toggleReminder,
  }
}

export type MonitorController = ReturnType<typeof useMonitor>
