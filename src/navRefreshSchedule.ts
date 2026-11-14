const DAY_MS = 24 * 60 * 60_000
const IST_OFFSET_MS = 330 * 60_000
const PUBLICATION_GRACE_MS = 2 * 60_000

// MFAPI's published daily IST ingestion times: https://www.mfapi.in/
const INGESTION_MINUTES_IST = [3 * 60 + 9, 5 * 60 + 5, 10 * 60 + 5, 14 * 60 + 5, 18 * 60 + 5, 21 * 60 + 5]

/** Return the next scheduled check without replaying earlier publication windows. */
export function nextNavRefreshAt(now = Date.now()): number {
  if (!Number.isFinite(now)) throw new RangeError('NAV refresh time must be a finite timestamp.')
  const dayStart = Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
  for (const minute of INGESTION_MINUTES_IST) {
    const at = dayStart + minute * 60_000 + PUBLICATION_GRACE_MS
    if (at > now) return at
  }
  return dayStart + DAY_MS + INGESTION_MINUTES_IST[0] * 60_000 + PUBLICATION_GRACE_MS
}
