import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '~': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/index': 'http://localhost:8080',
      '/mediaItem': 'http://localhost:8080',
      '/image': 'http://localhost:8080',
      '/video': 'http://localhost:8080',
      '/face': 'http://localhost:8080',
      '/matchingFaces': 'http://localhost:8080',
      '/thumbnails': 'http://localhost:8080',
      '/person': 'http://localhost:8080',
      '/feature': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/setting': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
