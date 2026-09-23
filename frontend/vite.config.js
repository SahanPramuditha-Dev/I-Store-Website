import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/(react-dom|react-router|node_modules[\\/]react[\\/])/.test(id)) return 'react-vendor'
          if (/(recharts|d3-)/.test(id)) return 'charts-vendor'
          if (/(\/|\\)(@mui|@emotion|lucide-react)(\/|\\)/.test(id)) return 'ui-vendor'
          return undefined
        }
      }
    }
  }
})
