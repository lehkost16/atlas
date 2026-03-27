import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          visNetwork: ['vis-network', 'vis-data'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.ATLAS_API_PORT || 8889}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
