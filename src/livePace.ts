/**
 * Adaptive pacing for live market prices.
 *
 * Prices refresh every 5s while the device keeps up. When the main thread stays blocked (a 250ms timer firing more
 * than 50ms late) or quote responses stay slow, the interval steps to 8s, then 10s, and steps back once things are calm.
 * Holdings and the index ticker poll on one shared beat, so both update together at any pace. A manual refresh
 * restarts the beat, and the next automatic poll follows a full interval after it.
 * iPhones expose no device or network-class signals, so pacing uses only what the page can measure itself. A timer is
 * used instead of requestAnimationFrame because a frame loop makes the browser render every frame, which itself costs
 * a slow phone noticeable work. Hidden pages are skipped, since browsers slow their timers on purpose.
 * Polling pauses entirely while the open screen shows no prices.
 */
export const PACE_STEPS = [5_000, 8_000, 10_000] as const

const WINDOW_MS = 10_000
const SAMPLE_MS = 250
const BLOCKED_MS = 50
const STEP_UP_BUSY = 0.2
const STEP_DOWN_BUSY = 0.05
const SLOW_RESPONSE_MS = 1_500
const FAST_RESPONSE_MS = 800
const CALM_WINDOWS_TO_STEP_DOWN = 2

export interface PaceSample { busy: number; responseMs: number | null }

/** Pure step rule, exported for tests: busy is the share of the window the main thread was blocked. */
export function nextPaceLevel(level: number, sample: PaceSample, calmWindows: number): { level: number; calmWindows: number } {
  const slow = sample.busy > STEP_UP_BUSY || (sample.responseMs != null && sample.responseMs > SLOW_RESPONSE_MS)
  if (slow) return { level: Math.min(level + 1, PACE_STEPS.length - 1), calmWindows: 0 }
  const calm = sample.busy < STEP_DOWN_BUSY && (sample.responseMs == null || sample.responseMs < FAST_RESPONSE_MS)
  if (!calm) return { level, calmWindows: 0 }
  return calmWindows + 1 >= CALM_WINDOWS_TO_STEP_DOWN
    ? { level: Math.max(level - 1, 0), calmWindows: 0 }
    : { level, calmWindows: calmWindows + 1 }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function createLivePace() {
  let level = 0
  let calmWindows = 0
  let demand = true
  let timer: ReturnType<typeof setInterval> | undefined
  let expected = 0
  // The first window after polling starts includes app start-up work, which is not a sign of a struggling device.
  let warmingUp = false
  let windowStart = 0
  let overrunMs = 0
  let responses: number[] = []
  // Beats fall on anchor + n × interval. The epoch anchor lines every poller up on the same wall-clock marks.
  let anchor = 0
  const listeners = new Set<() => void>()
  const restartListeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  const resetWindow = (at: number) => { windowStart = at; overrunMs = 0; responses = [] }

  const evaluate = (at: number) => {
    const elapsed = at - windowStart
    if (elapsed < WINDOW_MS) return
    if (warmingUp) { warmingUp = false; resetWindow(at); return }
    const next = nextPaceLevel(level, { busy: overrunMs / elapsed, responseMs: median(responses) }, calmWindows)
    calmWindows = next.calmWindows
    resetWindow(at)
    if (next.level !== level) { level = next.level; notify() }
  }

  const sample = () => {
    const at = performance.now()
    const late = at - expected
    expected = at + SAMPLE_MS
    // Hidden or long-suspended pages restart their window instead of counting deliberate timer throttling.
    if (document.hidden || late > 1_000) { resetWindow(at); return }
    if (late > BLOCKED_MS) overrunMs += late
    evaluate(at)
  }

  return {
    /** Milliseconds until the next poll, or null while the open screen shows no prices. */
    interval: (): number | null => demand ? PACE_STEPS[level] : null,
    level: () => level,
    /**
     * The first beat at least half an interval after `after`, or null while polling is paused. The half-interval gap
     * stops a poll that lands just before a beat (such as the first load) from firing again moments later.
     */
    nextBeatAt(after: number = Date.now()): number | null {
      if (!demand) return null
      const interval = PACE_STEPS[level]
      return anchor + Math.ceil((after + interval / 2 - anchor) / interval) * interval
    },
    /** Pace or demand changed. */
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    /** A manual refresh: the beat restarts now and every poller refreshes immediately. */
    restartBeat(at: number = Date.now()) { anchor = at; restartListeners.forEach((listener) => listener()) },
    onRestart(listener: () => void) { restartListeners.add(listener); return () => { restartListeners.delete(listener) } },
    /** Called by the app shell: false on screens without prices. */
    setDemand(next: boolean) { if (next !== demand) { demand = next; notify() } },
    recordResponse(ms: number) { if (Number.isFinite(ms) && ms >= 0) responses.push(ms) },
    /** Main-thread sampling runs only while live polling is active (market open). */
    watchMainThread(active: boolean) {
      if (active === (timer !== undefined)) return
      if (!active) { clearInterval(timer); timer = undefined; return }
      expected = performance.now() + SAMPLE_MS
      warmingUp = true
      resetWindow(performance.now())
      timer = setInterval(sample, SAMPLE_MS)
    },
  }
}

export const livePace = createLivePace()
