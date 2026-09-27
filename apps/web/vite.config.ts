import react from '@vitejs/plugin-react';
// Imported from vitest so the `test` block below is typed; the plugin API is identical.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keeps the initial bundle small: the vendor half changes far less often than
        // the application half, so it stays cached across deploys. The routes themselves
        // are split by `React.lazy` in App.tsx, which is what actually keeps the entry
        // chunk down — this only decides how the libraries are grouped for caching.
        //
        // Grouping by resolved path rather than by package name on purpose: naming
        // `react-dom` in a list does not catch `react-dom/client`, which is the entry the
        // application actually imports, so the renderer quietly ended up in the entry
        // chunk instead of the vendor one.
        manualChunks(id) {
          const path = id.replace(/\\/g, '/');
          if (!path.includes('/node_modules/')) return undefined;

          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(path)
          )
            return 'react';
          if (path.includes('/node_modules/@tanstack/')) return 'query';
          if (/\/node_modules\/(tailwind-merge|clsx)\//.test(path)) return 'styling';
          if (/\/node_modules\/(react-hook-form|zod)\//.test(path)) return 'forms';

          // Anything else stays wherever rollup puts it. A catch-all `vendor` chunk was
          // tried and is currently empty — every dependency the application actually
          // imports is named above — and an empty chunk is a warning on every build.
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
