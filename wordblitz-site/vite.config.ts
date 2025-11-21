import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const workspaceRoot = resolve(__dirname, '..')

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    fs: {
      allow: [__dirname, workspaceRoot],
    },
  },
})
