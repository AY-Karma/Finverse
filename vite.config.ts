import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { handleHistoryRequest } from './api/history'
import { handleQuoteRequest } from './api/quotes'

function localMarketDataApi(): Plugin {
  const handlers = new Map([
    ['/api/quotes', handleQuoteRequest],
    ['/api/history', handleHistoryRequest],
  ])
  return {
    name: 'finverse-local-market-data-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url
        if (!requestUrl) return next()
        const path = requestUrl.split('?')[0]
        const handler = handlers.get(path)
        if (!handler) return next()
        try {
          const result = await handler(
            new Request(`http://localhost${requestUrl}`, { method: request.method }),
          )
          response.statusCode = result.status
          result.headers.forEach((value, name) => response.setHeader(name, value))
          response.end(await result.text())
        } catch {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: 'Local market-data handler failed.' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localMarketDataApi()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react-vendor'
          if (id.includes('node_modules/recharts')) return 'charts-vendor'
          if (id.includes('node_modules/@e965/xlsx')) return 'xlsx-vendor'
        },
      },
    },
  },
})
