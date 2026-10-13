import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL?.trim().replace(/\/+$/, '') || 'http://localhost:8000'
  const apiProxy: ProxyOptions = {
    target: backendUrl,
    changeOrigin: true,
    rewrite: (requestPath) => requestPath.replace(/^\/api(?=\/|$)/, ''),
    // The backend refresh cookie uses /auth; browsers now request /api/auth.
    cookiePathRewrite: { '/auth': '/api/auth' },
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: { proxy: { '/api': apiProxy } },
  }
})
