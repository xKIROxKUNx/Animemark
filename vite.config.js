import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// O app é servido de https://xkiroxkunx.github.io/Animemark/, então tudo
// (inclusive o manifest e o service worker) precisa morar nessa subpasta.
const BASE = '/Animemark/';

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2020',
    sourcemap: true,
    // O chunk `firebase` fica em ~565 KB (≈140 KB gzip): é o SDK do Firestore,
    // não tem como enxugar. O limite evita um aviso inútil em todo build.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // O SDK do Firebase é o grosso do bundle e quase nunca muda; separá-lo
        // faz o service worker rebaixar só o código do app a cada atualização.
        manualChunks: (id) => (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase')
          ? 'firebase'
          : undefined),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'AnimeMark',
        short_name: 'AnimeMark',
        description: 'Nossa lista de animes para assistir',
        lang: 'pt-BR',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#12101a',
        theme_color: '#12101a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${BASE}index.html`,
        // O Firestore tem o próprio cache offline (IndexedDB); deixar o Workbox
        // interceptar essas chamadas só atrapalharia o streaming do listener.
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            // Capas do MyAnimeList: valem cache longo, são imutáveis por URL.
            urlPattern: /^https:\/\/cdn\.myanimelist\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'capas-mal',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
