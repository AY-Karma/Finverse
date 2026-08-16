import { parseSpreadsheet } from './spreadsheet'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null
  postMessage(message: unknown): void
}

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({ ok: true, positions: parseSpreadsheet(event.data) })
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not parse the spreadsheet.',
    })
  }
}
