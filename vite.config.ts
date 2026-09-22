import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Server functions read non-VITE_ secrets (SUPABASE_SECRET_KEY) from process.env.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    resolve: { tsconfigPaths: true },
    server: { port: 3000, strictPort: true },
    plugins: [tanstackStart(), viteReact()],
  }
})
