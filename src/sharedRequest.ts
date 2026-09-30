interface PendingRequest<T> {
  controller: AbortController
  promise: Promise<T>
  subscribers: number
}

/** Each subscriber can leave; the underlying request stops only when none remain. */
export function createSharedRequest<T>() {
  const pending = new Map<string, PendingRequest<T>>()
  return (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    let request = pending.get(key)
    if (!request) {
      const controller = new AbortController()
      request = { controller, promise: Promise.resolve().then(() => load(controller.signal)), subscribers: 0 }
      pending.set(key, request)
      const entry = request
      void request.promise.then(() => {
        if (pending.get(key) === entry) pending.delete(key)
      }, () => {
        if (pending.get(key) === entry) pending.delete(key)
      })
    }
    const entry = request
    entry.subscribers += 1
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', abort)
        entry.subscribers -= 1
        if (entry.subscribers === 0 && pending.get(key) === entry) {
          pending.delete(key)
          entry.controller.abort()
        }
      }
      const abort = () => { finish(); reject(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      entry.promise.then((value) => { finish(); resolve(value) }, (error) => { finish(); reject(error) })
    })
  }
}
