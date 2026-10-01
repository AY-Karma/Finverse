/** A deterministic monogram tile keeps each holding recognizable without remote logos. */

/** Stable 0–359 hue from the ticker so each holding keeps its own colour. */
export function tickerHue(ticker: string): number {
  let hash = 0
  for (let index = 0; index < ticker.length; index++) {
    hash = (hash * 31 + ticker.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

export function monogramTile(tickerBase: string, label?: string, mode: 'dark' | 'light' = 'dark'): string {
  const letters = (label ?? tickerBase).replace(/[^A-Z0-9]/g, '').slice(0, 3) || '₹'
  const hue = tickerHue(tickerBase)
  const fontSize = letters.length > 2 ? 11 : 15
  const bg = mode === 'light' ? `hsl(${hue} 45% 88%)` : `hsl(${hue} 28% 16%)`
  const fg = mode === 'light' ? `hsl(${hue} 55% 30%)` : `hsl(${hue} 70% 74%)`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" rx="10" fill="${bg}"/>` +
    `<text x="24" y="24" dy=".36em" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${fontSize}" font-weight="600" fill="${fg}">${letters}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
