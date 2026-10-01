import type { SpreadsheetParseResult } from './spreadsheet'

/** Parse outside the UI thread while retaining a fallback for environments without Web Workers. */
export function parseSpreadsheetPreviewInWorker(file: ArrayBuffer): Promise<SpreadsheetParseResult> {
  if (typeof Worker === 'undefined') {
    return import('./spreadsheet').then(({ parseSpreadsheetWithDiagnostics }) => parseSpreadsheetWithDiagnostics(file))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: SpreadsheetParseResult; error?: string }>) => {
      worker.terminate()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error || 'Could not parse the spreadsheet.'))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Could not parse the spreadsheet in the background.'))
    }
    worker.postMessage(file, [file])
  })
}
