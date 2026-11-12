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
        name: 'Fichas de Medição',
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
        // `index.html` fica FORA do precache. Antes ele entrava, e o worker
        // antigo servia o HTML velho indefinidamente: publicação nova nunca
        // aparecia no aparelho e parecia que nada tinha sido corrigido.
        globPatterns: ['**/*.{js,css,svg,png,woff2}'],
        globIgnores: ['**/index.html', '**/registerSW.js'],
        // Sem `navigateFallback`, a navegação vai sempre à rede primeiro.
        // Offline continua funcionando pela rota `NetworkFirst` abaixo, que cai
        // no cache quando não há sinal.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Abertura do app: rede primeiro; sem rede, usa a última cópia.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fichas-html',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
            },
          },
        ],
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
