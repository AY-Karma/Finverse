import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const googleNewsProxy = {
  '/api/google-news': {
    target: 'https://news.google.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/google-news/, ''),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: googleNewsProxy },
  preview: { proxy: googleNewsProxy },
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
