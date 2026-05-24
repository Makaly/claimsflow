import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { useAuthStore } from '@/store/authStore'
import { useClaimsStore } from '@/store/claimsStore'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import Dashboard from '@/pages/Dashboard'
import Claims from '@/pages/Claims'
import Documents from '@/pages/Documents'
import Profile from '@/pages/Profile'
import TermsOfService from '@/pages/TermsOfService'
import PrivacyPolicy from '@/pages/PrivacyPolicy'

// ── Role-split lazy chunks ────────────────────────────────────────────────────
// Each group is a separate Vite chunk (configured in vite.config.ts).
// Routes shared by multiple roles are kept in the baseline bundle above.

// Admin chunk
const UserManagement        = lazy(() => import('@/pages/UserManagement'))
const Roles                 = lazy(() => import('@/pages/Roles'))
const Permissions           = lazy(() => import('@/pages/Permissions'))
const Settings              = lazy(() => import('@/pages/Settings'))
const SystemConfigPage      = lazy(() => import('@/pages/SystemConfigPage'))
const DocumentClassifierEditor = lazy(() => import('@/pages/DocumentClassifierEditor'))
const UnknownDocuments      = lazy(() => import('@/pages/UnknownDocuments'))
const UnknownDocumentReview = lazy(() => import('@/pages/UnknownDocumentReview'))

// Finance chunk
const Payment               = lazy(() => import('@/pages/Payment'))
const ScanMeteringDashboard = lazy(() => import('@/pages/ScanMeteringDashboard'))

// Provider chunk
const ProviderApprovals     = lazy(() => import('@/pages/ProviderApprovals'))
const Providers             = lazy(() => import('@/pages/Providers'))
const Branches              = lazy(() => import('@/pages/Branches'))
const PreAuth               = lazy(() => import('@/pages/PreAuth'))
const ScanStation           = lazy(() => import('@/pages/ScanStation'))

// Claims-officer chunk
const WorkflowDashboard     = lazy(() => import('@/pages/WorkflowDashboard'))
const MakerQueue            = lazy(() => import('@/pages/MakerQueue'))
const CheckerQueue          = lazy(() => import('@/pages/CheckerQueue'))
const ClaimsOfficerQueue    = lazy(() => import('@/pages/ClaimsOfficerQueue'))
const FraudQueue            = lazy(() => import('@/pages/FraudQueue'))
const ActivityLogs          = lazy(() => import('@/pages/ActivityLogs'))
const Reports               = lazy(() => import('@/pages/Reports'))
const ProviderScorecard     = lazy(() => import('@/pages/ProviderScorecard'))
const AgingDashboard        = lazy(() => import('@/pages/AgingDashboard'))
const Appeals               = lazy(() => import('@/pages/Appeals'))
const BatchUpload           = lazy(() => import('@/pages/BatchUpload'))
const PolicyPlans           = lazy(() => import('@/pages/PolicyPlans'))
const MLLabelling           = lazy(() => import('@/pages/MLLabelling'))
const ZoneAnalytics         = lazy(() => import('@/pages/ZoneAnalytics'))
const TwoFactorSetup        = lazy(() => import('@/pages/TwoFactorSetup'))

// Shared fallback spinner — keep lightweight (no external deps)
function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm animate-pulse">
      Loading…
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode
  allowedRoles?: string[]
}) {
  const { isAuthenticated, user } = useAuthStore()
  // tab_auth is set in sessionStorage only when this tab went through an explicit
  // login. sessionStorage is not shared across tabs, so a URL copied into a new
  // tab will be missing this flag and gets redirected to /login even though the
  // HttpOnly cookie is still valid in the browser.
  const tabActive = sessionStorage.getItem('tab_auth') === '1'
  if (!isAuthenticated || !tabActive) return <Navigate to="/login" replace />
  if (allowedRoles && allowedRoles.length > 0) {
    const role = user?.role
    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to="/" replace />
    }
  }
  return <>{children}</>
}

const CIC_STAFF = ['admin', 'claims_officer', 'maker_checker', 'fraud_officer', 'finance']
const ADMIN_ONLY = ['admin']

function AppRoutes() {
  const { isAuthenticated, user, fetchProfile } = useAuthStore()
  const { fetchFromServer, serverLoaded } = useClaimsStore()
  const tabActive = sessionStorage.getItem('tab_auth') === '1'
  // A session is considered live in this tab only when both the persisted user
  // exists AND this tab explicitly authenticated (tab_auth in sessionStorage).
  const sessionLive = isAuthenticated && tabActive

  // Validate the session against the live HttpOnly cookie on every app boot.
  // Only runs when this tab went through login — new tabs (no tab_auth) are
  // redirected to /login by ProtectedRoute before any API call happens.
  useEffect(() => {
    if (sessionLive) {
      fetchProfile()
    }
    // Run once on mount — deliberately omitting deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load claims from server once after login
  useEffect(() => {
    if (sessionLive && !serverLoaded) {
      fetchFromServer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLive])

  return (
    <Routes>
      <Route
        path="/login"
        element={sessionLive ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={sessionLive ? <Navigate to="/" replace /> : <Register />}
      />
      <Route
        path="/forgot-password"
        element={sessionLive ? <Navigate to="/" replace /> : <ForgotPassword />}
      />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageFallback />}>
              <Layout />
            </Suspense>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/providers" element={<ProtectedRoute allowedRoles={['admin', 'claims_officer', 'maker_checker', 'fraud_officer']}><Providers /></ProtectedRoute>} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/batch-upload" element={<BatchUpload />} />
        <Route path="/workflow" element={<ProtectedRoute allowedRoles={CIC_STAFF}><WorkflowDashboard /></ProtectedRoute>} />
        <Route path="/workflow/maker" element={<ProtectedRoute allowedRoles={['admin','claims_officer','maker_checker']}><MakerQueue /></ProtectedRoute>} />
        <Route path="/workflow/checker" element={<ProtectedRoute allowedRoles={['admin','maker_checker']}><CheckerQueue /></ProtectedRoute>} />
        <Route path="/workflow/claims-officer" element={<ProtectedRoute allowedRoles={['admin','claims_officer']}><ClaimsOfficerQueue /></ProtectedRoute>} />
        <Route path="/workflow/fraud" element={<ProtectedRoute allowedRoles={['admin','fraud_officer','claims_officer']}><FraudQueue /></ProtectedRoute>} />
        <Route path="/provider-approvals" element={<ProtectedRoute allowedRoles={['admin','claims_officer']}><ProviderApprovals /></ProtectedRoute>} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/users" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><UserManagement /></ProtectedRoute>} />
        <Route path="/roles" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Roles /></ProtectedRoute>} />
        <Route path="/permissions" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Permissions /></ProtectedRoute>} />
        <Route path="/activity-logs" element={<ProtectedRoute allowedRoles={['admin','claims_officer','fraud_officer']}><ActivityLogs /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute allowedRoles={['admin','claims_officer']}><Reports /></ProtectedRoute>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Settings /></ProtectedRoute>} />
        <Route path="/settings/document-classifiers/:id" element={<ProtectedRoute allowedRoles={['admin']}><DocumentClassifierEditor /></ProtectedRoute>} />
        <Route path="/unknown-documents" element={<ProtectedRoute allowedRoles={['admin','maker_checker']}><UnknownDocuments /></ProtectedRoute>} />
        <Route path="/unknown-documents/:id" element={<ProtectedRoute allowedRoles={['admin','maker_checker']}><UnknownDocumentReview /></ProtectedRoute>} />
        <Route path="/2fa-setup" element={<TwoFactorSetup />} />
        <Route path="/appeals" element={<ProtectedRoute><Appeals /></ProtectedRoute>} />
        <Route path="/payment" element={<ProtectedRoute allowedRoles={['admin','finance','claims_officer']}><Payment /></ProtectedRoute>} />
        <Route path="/system-config" element={<ProtectedRoute allowedRoles={['admin']}><SystemConfigPage /></ProtectedRoute>} />
        <Route path="/workflow/aging" element={<ProtectedRoute allowedRoles={CIC_STAFF}><AgingDashboard /></ProtectedRoute>} />
        <Route path="/provider-scorecard" element={<ProtectedRoute allowedRoles={['admin','claims_officer']}><ProviderScorecard /></ProtectedRoute>} />
        <Route path="/pre-auth" element={<ProtectedRoute><PreAuth /></ProtectedRoute>} />
        <Route path="/scan-station" element={<ProtectedRoute allowedRoles={['admin','claims_officer','maker_checker']}><ScanStation /></ProtectedRoute>} />
        <Route path="/policy-plans" element={<ProtectedRoute allowedRoles={['admin','claims_officer']}><PolicyPlans /></ProtectedRoute>} />
        <Route path="/ml-labelling" element={<ProtectedRoute allowedRoles={['admin','claims_officer','fraud_officer']}><MLLabelling /></ProtectedRoute>} />
        <Route path="/zone-analytics" element={<ProtectedRoute allowedRoles={['admin','claims_officer','fraud_officer','maker_checker']}><ZoneAnalytics /></ProtectedRoute>} />
        <Route path="/scan-metering" element={<ProtectedRoute allowedRoles={['admin','finance','provider_admin','claims_officer','maker_checker','fraud_officer']}><ScanMeteringDashboard /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
