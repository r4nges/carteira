/// <reference types="vitest/config" />
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Cores do manifesto: as mesmas de src/estilos/tokens.css (tema claro).
const COR_FUNDO = '#f2f4f3'
const COR_TEMA = '#f2f4f3'

export default defineConfig(({ mode }) => ({
  // Caminhos relativos: funciona na raiz ou num subcaminho (GitHub Pages).
  base: './',
  plugins: [
    preact(),
    mode !== 'test' &&
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Carteira',
          short_name: 'Carteira',
          description: 'Acompanhamento da carteira de investimentos.',
          lang: 'pt-BR',
          dir: 'ltr',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          orientation: 'any',
          theme_color: COR_TEMA,
          background_color: COR_FUNDO,
          icons: [
            { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icone-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/teste/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))
