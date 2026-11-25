const LANDING_SEEN_KEY = 'finverse:landing-seen'
const WORKSPACE_KEYS = ['finverse:folios', 'finverse:settings']

/**
 * The landing page is shown once per browser. A browser that has seen it, or already holds a workspace,
 * opens the app instead, including after every folio is removed.
 */
export function isFirstVisit(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return [LANDING_SEEN_KEY, ...WORKSPACE_KEYS].every((key) => storage.getItem(key) == null)
  } catch {
    return false
  }
}

export function markLandingSeen(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(LANDING_SEEN_KEY, '1') } catch { /* without storage the app still opens from the landing CTA */ }
}
