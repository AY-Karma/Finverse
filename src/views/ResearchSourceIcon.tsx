const DOCUMENT_PATH = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5ZM14 3v5h5M8 12h8m-8 4h6'

const SOURCE_ICON_PATHS: Record<string, string> = {
  'Company financials': 'M4 3h16v18H4V3Zm4 13v-4m4 4V9m4 7V6M7 18h10',
  'Exchange quote': 'M3 9l9-5 9 5H3Zm4 0v8m5-8v8m5-8v8M4 17h16M3 20h18',
  'Price chart': 'M4 4v16h16M7 15l4-5 4 3 5-7M17 6h3v3',
  'Scheme factsheet': 'M12 3v9h9A9 9 0 0 0 12 3Zm-3 1a9 9 0 1 0 11 11H9V4Z',
  'Costs and risk': 'M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Zm0 5v5m0 3h.01',
  'Scheme documents': 'M8 7h11v14H8V7ZM5 17H3V3h11v2M11 11h5m-5 4h5m-5 3h3',
  'Company filings': 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h7m-7 4 2 2 5-5',
  'Issuer factsheet': 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  'Investment documents': 'M3 5h7l2 3h9v12H3V5Zm4 7h10m-10 4h6',
}

export function ResearchSourceIcon({ label }: { label: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={SOURCE_ICON_PATHS[label] || DOCUMENT_PATH} />
  </svg>
}
