import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: true,
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
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3000,
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
