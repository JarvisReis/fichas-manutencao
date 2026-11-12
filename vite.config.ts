import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // O técnico não pode ficar preso na versão antiga: o worker novo assume
      // na hora e o app recarrega sozinho (ver src/main.tsx).
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Fichas Metrô',
        short_name: 'Fichas',
        description: 'Fichas de medição de contator e seccionador — uso em campo, offline',
        theme_color: '#0b3d91',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never)
