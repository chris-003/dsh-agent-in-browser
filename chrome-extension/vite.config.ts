import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Vite injects <link rel="modulepreload" crossorigin> + the modulepreload-polyfill
// into built entry HTML. In an MV3 extension these preloads resolve in a different
// world and Chromium logs "cross-world extension resource mismatch" warnings (they
// show up as problems in the extension's error page). Modern browsers support
// modulepreload natively, so strip the preload links; the entry <script type=module>
// still loads the full module graph. Purely cosmetic; no functional impact.
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

// Multi-entry MV3 extension build using Vite:
//  - service-worker.ts  -> dist/service-worker.js  (ES module background)
//  - offscreen.html     -> dist/offscreen.html + bundled script
//  - public/manifest.json is copied to dist/ by Vite.
export default defineConfig({
  plugins: [react(), stripModulepreload()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
        offscreen: resolve(import.meta.dirname, 'offscreen.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
})
