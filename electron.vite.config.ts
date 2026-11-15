import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // better-sqlite3 is a native module and the Agent SDK ships its own
        // executable next to its code: both must load from node_modules at runtime.
        external: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk']
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // The preload runs sandboxed, which only supports CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()]
  }
})
