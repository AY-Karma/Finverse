import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
