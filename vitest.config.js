import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,jsx}', 'server/**/*.js'],
      exclude: ['node_modules/', 'dist/', 'src/test/'],
    },
    exclude: ['node_modules/', 'dist/', 'e2e/'],
  },
})
