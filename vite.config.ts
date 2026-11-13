import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: command === 'build'
    ? { 'process.env.NODE_ENV': JSON.stringify('production') }
    : undefined,
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
}))
