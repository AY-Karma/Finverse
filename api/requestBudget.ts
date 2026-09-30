const WINDOW_MS = 60_000
const MAX_ACTIVE = 8
const MAX_REQUESTS_PER_WINDOW = 600
const MAX_CACHE_ENTRIES = 128
const MAX_CACHE_BYTES = 16 * 1024 * 1024
const FAILURE_CACHE_MS = 15_000

interface CachedResponse {
  body: string
  status: number
  headers: [string, string][]
  expiresAt: number
  bytes: number
}

/** Warm-instance admission and caching. Deployment-wide limits still belong at the edge. */
export function createRequestBudget(now: () => number = Date.now) {
  const cache = new Map<string, CachedResponse>()
  const pending = new Map<string, Promise<CachedResponse>>()
  let cacheBytes = 0
  let windowStart = now()
  let requests = 0

  function remove(key: string) {
    cacheBytes -= cache.get(key)?.bytes ?? 0
    cache.delete(key)
  }

  function restore(entry: CachedResponse): Response {
    return new Response(entry.body, { status: entry.status, headers: entry.headers })
  }

  return async (
    key: string,
    successTtlMs: number,
    load: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> => {
    const timestamp = now()
    if (timestamp - windowStart >= WINDOW_MS) {
      windowStart = timestamp
      requests = 0
    }
    requests += 1
    const reject = () => new Response(JSON.stringify({ error: 'Request budget exceeded. Try again shortly.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' },
    })
    if (requests > MAX_REQUESTS_PER_WINDOW) return reject()
    for (const [storedKey, entry] of cache) {
      if (entry.expiresAt <= timestamp) remove(storedKey)
    }
    const cached = cache.get(key)
    if (cached) return restore(cached)
    const existing = pending.get(key)
    if (existing) return restore(await existing)
    if (pending.size >= MAX_ACTIVE) return reject()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded.', 'TimeoutError')), 9_000)
    const task = (async () => {
      let response: Response
      try {
        response = await withAbort(load(controller.signal), controller.signal)
      } catch {
        response = Response.json({ error: 'Provider deadline exceeded or data unavailable.' }, { status: 502 })
      }
      const body = await response.text()
      const entry: CachedResponse = {
        body,
        status: response.status,
        headers: [...response.headers.entries()],
        expiresAt: now() + (response.ok ? successTtlMs : FAILURE_CACHE_MS),
        bytes: new TextEncoder().encode(body).byteLength,
      }
      if (entry.bytes <= MAX_CACHE_BYTES) {
        while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + entry.bytes > MAX_CACHE_BYTES) {
          const first = cache.keys().next().value
          if (first === undefined) break
          remove(first)
        }
        cache.set(key, entry)
        cacheBytes += entry.bytes
      }
      return entry
    })()
    pending.set(key, task)
    try {
      return restore(await task)
    } finally {
      clearTimeout(timeout)
      pending.delete(key)
    }
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Cap bytes while streaming, including chunked responses without Content-Length. */
export async function readBoundedText(response: Response, maximumBytes: number, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > maximumBytes) {
    await response.body?.cancel()
    throw new Error('Provider response is too large.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await withAbort(reader.read(), signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) throw new Error('Provider response is too large.')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
