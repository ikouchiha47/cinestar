import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            sourcemap: true,
            rollupOptions: {
              // Externalize native/CJS deps so Rollup doesn't bundle them into ESM,
              // which would break usages of __dirname and other CJS globals.
              external: [
                // native/binary
                'sharp',
                'better-sqlite3',
                'sqlite-vec',
                'sqlite-vec-darwin-arm64',
                // media/tooling
                'ffmpeg-static',
                'fluent-ffmpeg',
                'nodejs-whisper',
                // networking/utils
                'node-fetch',
                // node built-ins (defensive; Rollup already treats these specially)
                'fs', 'path', 'os', 'url', 'util', 'events', 'stream', 'buffer', 'zlib', 'child_process'
              ]
            }
          }
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
