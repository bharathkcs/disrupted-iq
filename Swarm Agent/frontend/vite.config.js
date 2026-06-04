import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Determine backend URL based on environment
const backendUrl = process.env.VITE_API_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['leaflet'],
    exclude: ['react-leaflet'],
  },
  define: {
    'process.env.VITE_API_URL': JSON.stringify(backendUrl),
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api':       { target: backendUrl, changeOrigin: true },
      '/health':    { target: backendUrl, changeOrigin: true },
      '/socket.io': { target: backendUrl, changeOrigin: true, ws: true },
    },
  },
})
