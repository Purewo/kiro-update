import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Web SPA build. Replaces the Electron preload bridge with HTTP via window.fetch.
// Dev: vite serves on 5173 with API proxy to the admin server (default 19091).
// Prod: builds static files into dist/, served by Fastify @fastify/static.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [react(), tailwindcss()],
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
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
