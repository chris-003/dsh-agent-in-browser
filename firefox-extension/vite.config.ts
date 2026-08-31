import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Vite injects <link rel="modulepreload" crossorigin> + the modulepreload-polyfill
// into built entry HTML. In a WebExtension these preloads can resolve oddly (the
// Chromium "cross-world extension resource mismatch" warnings). Modern browsers
// support modulepreload natively, so strip the preload links; the entry
// <script type=module> still loads the full module graph. Purely cosmetic.
function stripModulepreload() {
  return {
    name: 'strip-modulepreload',
    enforce: 'post',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html') && typeof file.source === 'string') {
          file.source = file.source.replace(/\n?\s*<link rel="modulepreload"[^>]*>/g, '')
        }
      }
    },
  }
}

// Firefox MV2 build using Vite:
//  - background.html  -> dist/background.html (persistent background page; loads
//    the bundled module, which owns the WebSocket + all action handlers and has
//    DOM access for the region-screenshot canvas crop)
//  - popup / options / sidepanel HTML -> dist/*.html + bundled scripts
//  - public/manifest.json is copied to dist/ by Vite.
export default defineConfig({
  plugins: [react(), stripModulepreload()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'background.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
})
