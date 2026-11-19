import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { handleHistoryRequest } from './api/history'
import { handleQuoteRequest } from './api/quotes'
import { handleNewsRequest } from './api/news'
import { handleEventsRequest } from './api/events'
import { handleNseListingsRequest } from './api/nseListings'
import { handleMarketCapRequest } from './api/marketCap'
import { handleIpoRequest } from './api/ipos'
import { handleIpoGmpHistoryRequest } from './api/ipoGmpHistory'

function localMarketDataApi(): Plugin {
  const handlers = new Map([
    ['/api/quotes', handleQuoteRequest],
    ['/api/history', handleHistoryRequest],
    ['/api/news', handleNewsRequest],
    ['/api/events', handleEventsRequest],
    ['/api/nseListings', handleNseListingsRequest],
    ['/api/marketCap', handleMarketCapRequest],
    ['/api/ipos', handleIpoRequest],
    ['/api/ipoGmpHistory', handleIpoGmpHistoryRequest],
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

function localSipEntry(): Plugin {
  return {
    name: 'finverse-local-sip-entry',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!['/', '/app', '/app/'].includes(request.url ?? '')) return next()
        response.writeHead(302, { Location: '/app/settings' })
        response.end()
      })
    },
  }
}

/** `/` and `/app` open Overview, so fetch its lazy chunk alongside the entry instead of after the entry runs. Low priority keeps the entry first on slow links. */
function preloadOverview(): Plugin {
  return {
    name: 'finverse-preload-overview',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        const chunks = new Map(Object.values(bundle ?? {}).flatMap((output) => output.type === 'chunk' ? [[output.fileName, output] as const] : []))
        const overview = [...chunks.values()].find((chunk) => chunk.facadeModuleId?.endsWith('/src/views/Overview.tsx'))
        if (!overview) throw new Error('Overview chunk not found for preloading.')
        const graph = new Set([overview.fileName])
        for (const file of graph) for (const dependency of chunks.get(file)?.imports ?? []) graph.add(dependency)
        const pending = (file: string) => !html.includes(`/${file}"`)
        const styles = [...graph].flatMap((file) => [...(chunks.get(file)?.viteMetadata?.importedCss ?? [])])
        const link = (attrs: Record<string, string | true>) => ({ tag: 'link', attrs: { ...attrs, crossorigin: true, fetchpriority: 'low' }, injectTo: 'head' as const })
        return [
          ...[...graph].filter(pending).map((file) => link({ rel: 'modulepreload', href: `/${file}` })),
          ...[...new Set(styles)].filter(pending).map((file) => link({ rel: 'preload', as: 'style', href: `/${file}` })),
        ]
      },
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localMarketDataApi(), preloadOverview(), ...(mode === 'sip-prototype' ? [localSipEntry()] : [])],
  test: {
    exclude: [...configDefaults.exclude, 'docs/**'],
  },
  optimizeDeps: { entries: ['index.html'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Exact package match: react-remove-scroll and other react-* helpers belong with the lazy views that use them.
          if (/\/node_modules\/(react|react-dom)\//.test(id)) return 'react-vendor'
          if (id.includes('node_modules/@e965/xlsx')) return 'xlsx-vendor'
        },
      },
    },
  },
}))
