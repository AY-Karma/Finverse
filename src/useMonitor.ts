import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './useStore'
import { privateValue } from './privacy'
import { emptyMonitorReadingState, parseMonitorReadingState, type MonitorReadingState } from './monitorReading'
import {
  evaluateMonitorRules, hasDuplicateMonitorRule, holdingIdentity, loadMonitorState, reconcileMonitorRules, saveMonitorState, validReminderDate,
  MONITOR_STORAGE_KEY,
  type AlertState, type MonitorAlert, type RuleCondition,
} from './monitor'

function today(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function persistedMonitor(): string | null | undefined {
  try { return localStorage.getItem(MONITOR_STORAGE_KEY) } catch { return undefined }
}

export function useMonitor() {
  const { positions, liveQuotes, settings, refreshNow, marketDataRefreshing, marketDataResult, workspaceReadOnly } = useStore()
  const [loaded] = useState(() => ({ ...loadMonitorState(), raw: persistedMonitor() }))
  const persistedRevision = useRef(loaded.raw)
  const [state, setState] = useState(loaded.state)
  const savedState = useRef<typeof state | null>(null)
  const [status, setStatus] = useState(() => ({ message: settings.allowExternalData ? '' : 'External market data is off. Enable it in Settings to load quote updates.', revision: 0 }))
  const [storageError, setStorageError] = useState(loaded.error)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now)

  const setStatusMessage = useCallback((message: string) => {
    setStatus((current) => ({ message, revision: current.revision + 1 }))
  }, [])

  const reloadMonitor = useCallback(() => {
    const restored = loadMonitorState()
    persistedRevision.current = persistedMonitor()
    setState(restored.state)
    setStorageError(restored.error)
  }, [])

  function canChangeMonitor(): boolean {
    if (workspaceReadOnly) {
      setStorageError('This workspace changed in another tab. Reload it before making changes.')
      return false
    }
    if (persistedMonitor() !== persistedRevision.current) {
      reloadMonitor()
      setStatusMessage('Monitor changed in another tab. Review it and retry your change.')
      return false
    }
    return true
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === MONITOR_STORAGE_KEY) reloadMonitor()
    }
    window.addEventListener('finverse:monitor-restored', reloadMonitor)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('finverse:monitor-restored', reloadMonitor)
      window.removeEventListener('storage', handleStorage)
    }
  }, [reloadMonitor])

  const rules = useMemo(() => reconcileMonitorRules(state.rules, positions), [state.rules, positions])
  const reading = useMemo(() => state.reading ?? emptyMonitorReadingState(), [state.reading])

  useEffect(() => {
    if (workspaceReadOnly) return
    if (rules.length === state.rules.length && rules.every((rule, index) => {
      const current = state.rules[index]
      return current && rule.id === current.id && rule.holdingId === current.holdingId && rule.holding === current.holding && rule.unresolved === current.unresolved
    })) return
    setState((current) => ({ ...current, rules: reconcileMonitorRules(current.rules, positions) }))
  }, [rules, state.rules, positions, workspaceReadOnly])

  useEffect(() => {
    if (workspaceReadOnly) return
    setState((current) => evaluateMonitorRules(current, positions, liveQuotes, now, settings.allowExternalData))
  }, [positions, liveQuotes, rules, now, settings.allowExternalData, workspaceReadOnly])

  useEffect(() => {
    if (workspaceReadOnly) return
    if (persistedMonitor() !== persistedRevision.current) {
      reloadMonitor()
      setStatusMessage('Monitor changed in another tab. Review it and retry your change.')
      return
    }
    if (savedState.current === state) return
    if (!saveMonitorState(state)) setStorageError('Monitor changes could not be saved. They will only last in this session.')
    else {
      savedState.current = state
      persistedRevision.current = persistedMonitor()
      setStorageError('')
    }
  }, [state, workspaceReadOnly, reloadMonitor, setStatusMessage])

  function saveRule(input: { id?: string; holdingId: string; condition: RuleCondition; threshold: number }): boolean {
    if (!canChangeMonitor()) return false
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
    if (!canChangeMonitor()) return false
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
    if (alertState === 'snoozed') {
      snoozeAlert(id, Date.now() + 86_400_000)
      return
    }
    if (!canChangeMonitor()) return
    if (!['open', 'reviewed'].includes(alertState)) return
    setState((current) => ({ ...current, alerts: current.alerts.map((alert) => {
      if (alert.id !== id) return alert
      const { snoozedUntil: _deadline, ...rest } = alert
      return { ...rest, state: alertState }
    }) }))
    setStatusMessage(alertState === 'open' ? 'Alert reopened.' : 'Alert marked reviewed.')
  }

  function snoozeAlert(id: string, until: number): boolean {
    if (!canChangeMonitor()) return false
    const now = Date.now()
    if (!state.alerts.some((alert) => alert.id === id) || !Number.isFinite(until) || until <= now || until > 8_640_000_000_000_000) {
      setStatusMessage('Choose a future time for this alert.')
      return false
    }
    setState((current) => ({ ...current, alerts: current.alerts.map((alert) => alert.id === id ? { ...alert, state: 'snoozed', snoozedUntil: until } : alert) }))
    setStatusMessage('Alert snoozed. It will return when Monitor is open after the chosen time.')
    return true
  }

  function updateReading(reading: MonitorReadingState): boolean {
    if (!canChangeMonitor()) return false
    let validated: MonitorReadingState
    try { validated = parseMonitorReadingState(reading) } catch {
      setStatusMessage('Reading preferences could not be saved. Reload Monitor and try again.')
      return false
    }
    const next = { ...state, reading: validated }
    if (!saveMonitorState(next)) {
      setStorageError('Reading preferences could not be saved. Free browser storage and try again.')
      return false
    }
    persistedRevision.current = persistedMonitor()
    setStorageError('')
    savedState.current = next
    setState((current) => current === state ? next : { ...current, reading: validated })
    return true
  }

  function toggleRule(id: string) {
    if (!canChangeMonitor()) return
    setState((current) => ({ ...current, rules: current.rules.map((rule) => rule.id === id ? { ...rule, active: !rule.active } : rule) }))
    setStatusMessage('Watch rule updated.')
  }

  function deleteRule(id: string) {
    if (!canChangeMonitor()) return
    setState((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }))
    setStatusMessage('Watch rule removed. Previous observations remain in your history.')
  }

  function toggleReminder(id: string) {
    if (!canChangeMonitor()) return
    setState((current) => ({ ...current, events: current.events.map((event) => event.id === id ? { ...event, reminder: !event.reminder } : event) }))
    setStatusMessage('Reminder updated.')
  }

  const refresh = useCallback(async () => {
    if (workspaceReadOnly) {
      setStorageError('This workspace changed in another tab. Reload it before making changes.')
      return
    }
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
  }, [refreshNow, workspaceReadOnly])

  useEffect(() => {
    if (!settings.allowExternalData) return
    if (marketDataResult?.failed && !marketDataResult.updated) setStatusMessage('Latest quotes could not be reached. Showing previous provider observations where available.')
  }, [marketDataResult, settings.allowExternalData])

  const redact = (item: MonitorAlert): MonitorAlert => !settings.hideValues ? item : ({
    ...item,
    holding: privateValue(item.holding, true),
    title: 'Watch observation hidden',
    reason: 'Values are hidden.',
    evidence: 'Provider observation details are hidden while Hide values is enabled.',
    metrics: item.metrics.map((metric) => ({ ...metric, value: privateValue(metric.value, true), trend: 'neutral' })),
  })
  const currentDate = today(now)
  return {
    now,
    positions,
    hideValues: settings.hideValues,
    allowExternalData: settings.allowExternalData,
    alerts: state.alerts.map(redact),
    rules,
    reading,
    events: [...state.events].sort((a, b) => a.date.localeCompare(b.date)).map((event) => settings.hideValues
      ? { ...event, holding: privateValue(event.holding, true), title: privateValue(event.title, true) }
      : event.unresolved ? { ...event, holding: `${event.holding} · Holding unavailable` } : event),
    counts: {
      open: state.alerts.filter((alert) => alert.state === 'open').length,
      reviewed: state.alerts.filter((alert) => alert.state === 'reviewed').length,
      snoozed: state.alerts.filter((alert) => alert.state === 'snoozed').length,
      activeRules: rules.filter((rule) => rule.active && !rule.unresolved).length,
      upcoming: state.events.filter((event) => event.reminder && !event.unresolved && event.date >= currentDate).length,
    },
    statusMessage: storageError || status.message,
    statusRevision: status.revision,
    refreshing: refreshing || marketDataRefreshing,
    refresh,
    setAlertState,
    snoozeAlert,
    updateReading,
    saveRule,
    toggleRule,
    deleteRule,
    addReminder,
    toggleReminder,
  }
}

export type MonitorController = ReturnType<typeof useMonitor>
