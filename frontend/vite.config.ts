import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'

// Read the package version once at config time so the web client can tag its
// uploads with the build version (X-App-Version header). See src/services/api.ts.
const pkgVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'),
).version as string

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // No source maps in production builds — they expose the original
    // TypeScript source (and make vulnerability hunting trivial) to anyone who
    // opens devtools on the deployed site. Re-enable locally if needed.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split output by role group so each role downloads only its pages.
        // Matches the lazy() chunk groupings in App.tsx.
        manualChunks(id: string) {
          // Vendor chunks (large deps isolated for long-term caching)
          // recharts/d3 intentionally excluded from a separate chunk — circular
          // imports inside recharts cause a TDZ crash when Rollup isolates them.
          if (id.includes('node_modules/@radix-ui')) return 'vendor-radix'
          if (id.includes('node_modules')) return 'vendor'

          // Role chunks (match lazy() groupings in App.tsx)
          if (/pages\/(UserManagement|Roles|Permissions|Settings|SystemConfig|DocumentClassifier|UnknownDocuments)/.test(id)) return 'chunk-admin'
          if (/pages\/(Payment|ScanMetering)/.test(id)) return 'chunk-finance'
          if (/pages\/(ProviderApprovals|Providers|Branches|PreAuth|ScanStation)/.test(id)) return 'chunk-provider'
          if (/pages\/(WorkflowDashboard|MakerQueue|CheckerQueue|ClaimsOfficerQueue|FraudQueue|ActivityLogs|Reports|ProviderScorecard|AgingDashboard|Appeals|BatchUpload|PolicyPlans|MLLabelling|ZoneAnalytics|TwoFactorSetup)/.test(id)) return 'chunk-claims-officer'
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['tesseract.js'],
  },
  server: {
    port: 3000,
    // Leave HMR on the same port Vite actually picked. Hard-coding 3000 made
    // the WS connection 404 whenever the dev server fell back to 3001 because
    // port 3000 was busy.
    hmr: {
      protocol: 'ws',
      host: 'localhost',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
