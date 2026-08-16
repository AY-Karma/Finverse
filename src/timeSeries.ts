/** Keep evenly spaced samples, including both endpoints, for lightweight charts. */
export function downsampleSeries<T>(rows: T[], maximum: number): T[] {
  if (rows.length <= maximum) return rows
  if (maximum <= 1) return rows.slice(0, Math.max(0, maximum))
  const step = (rows.length - 1) / (maximum - 1)
  return Array.from({ length: maximum }, (_, index) => rows[Math.round(index * step)])
}
