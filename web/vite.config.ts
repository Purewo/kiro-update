import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.ADMIN_TARGET || 'http://127.0.0.1:19091',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.ADMIN_TARGET || 'http://127.0.0.1:19091',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
