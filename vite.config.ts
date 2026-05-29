import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed dev server and must not watch the Rust build output.
export default defineConfig({
  plugins: [react()],
  // Relative base so the built assets load from file:// inside Tauri
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Never watch the Rust side — its target/ dir churns constantly
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
