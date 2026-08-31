import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Multi-entry MV3 extension build using Vite:
//  - service-worker.ts  -> dist/service-worker.js  (ES module background)
//  - offscreen.html     -> dist/offscreen.html + bundled script
//  - public/manifest.json is copied to dist/ by Vite.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
        offscreen: resolve(import.meta.dirname, 'offscreen.html'),
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
