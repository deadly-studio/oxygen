import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // Relative asset paths: the built bundle can end up mounted at any depth
  // (`/cms/admin`, `/admin`, ...) — see docs/BUILD_PLAN.md#12-stretch-admin-ui.
  base: './',
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
  server: {
    // Local dev convenience: `pnpm dev:web` proxies API calls to a real
    // oxygen() server running separately (e.g. examples/basic's `pnpm dev`).
    proxy: {
      '/cms': 'http://localhost:3000',
    },
  },
})
