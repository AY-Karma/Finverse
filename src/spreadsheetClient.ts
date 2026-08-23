import type { Position } from './types'

/** Parse outside the UI thread while retaining a fallback for environments without Web Workers. */
export function parseSpreadsheetInWorker(file: ArrayBuffer): Promise<Position[]> {
  if (typeof Worker === 'undefined') {
    return import('./spreadsheet').then(({ parseSpreadsheet }) => parseSpreadsheet(file))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; positions?: Position[]; error?: string }>) => {
      worker.terminate()
      if (event.data.ok && event.data.positions) resolve(event.data.positions)
      else reject(new Error(event.data.error || 'Could not parse the spreadsheet.'))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Could not parse the spreadsheet in the background.'))
    }
    worker.postMessage(file, [file])
  })
}
