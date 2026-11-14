interface IndexSession {
  timeZone: string
  windows: readonly (readonly [number, number])[]
}

const US: IndexSession = { timeZone: 'America/New_York', windows: [[570, 960]] }
const EUROPE: IndexSession = { timeZone: 'Europe/Paris', windows: [[540, 1050]] }
const SESSIONS: Record<string, IndexSession> = {
  'sp-500': US, 'nasdaq-composite': US, 'dow-jones': US,
  'ftse-100': { timeZone: 'Europe/London', windows: [[480, 990]] },
  'nikkei-225': { timeZone: 'Asia/Tokyo', windows: [[540, 690], [750, 930]] },
  'hang-seng': { timeZone: 'Asia/Hong_Kong', windows: [[570, 720], [780, 960]] },
  dax: EUROPE, 'cac-40': EUROPE,
}
const formatters = new Map<string, Intl.DateTimeFormat>()

/** Regular sessions only; foreign holiday and shortened-session calendars are unavailable. */
export function isGlobalIndexSessionOpen(id: string, date = new Date()): boolean {
  const session = SESSIONS[id]
  if (!session) return false
  let formatter = formatters.get(session.timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: session.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(session.timeZone, formatter)
  }
  const parts = formatter.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  if (value('weekday') === 'Sat' || value('weekday') === 'Sun') return false
  const minute = Number(value('hour')) * 60 + Number(value('minute'))
  return session.windows.some(([start, end]) => minute >= start && minute < end)
}
