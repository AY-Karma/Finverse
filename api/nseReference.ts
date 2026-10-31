/** Strict parser shared by NSE's official equity and ETF reference files. */
export function readNseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closedQuote = false
  const endField = () => { row.push(field.trim()); field = ''; closedQuote = false }
  const endRow = () => {
    endField()
    if (row.some(Boolean)) rows.push(row)
    row = []
    if (rows.length > 10_000) throw new Error('NSE reference is too large')
  }
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character !== '"') field += character
      else if (csv[index + 1] === '"') { field += '"'; index += 1 }
      else { quoted = false; closedQuote = true }
    } else if (character === ',') endField()
    else if (character === '\r' || character === '\n') {
      endRow()
      if (character === '\r' && csv[index + 1] === '\n') index += 1
    } else if (character === '"') {
      if (field.trim() || closedQuote) throw new Error('Invalid NSE reference CSV')
      field = ''; quoted = true
    } else if (closedQuote) {
      if (character.trim()) throw new Error('Invalid NSE reference CSV')
    } else field += character
  }
  if (quoted) throw new Error('Invalid NSE reference CSV')
  if (field || row.length) endRow()
  return rows
}
