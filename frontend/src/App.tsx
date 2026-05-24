import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { useAuthStore } from '@/store/authStore'
import { useClaimsStore } from '@/store/claimsStore'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import Appeals from '@/pages/Appeals'
import Payment from '@/pages/Payment'
import SystemConfigPage from '@/pages/SystemConfigPage'
import AgingDashboard from '@/pages/AgingDashboard'
import Dashboard from '@/pages/Dashboard'
import Claims from '@/pages/Claims'
import Providers from '@/pages/Providers'
import Documents from '@/pages/Documents'
import BatchUpload from '@/pages/BatchUpload'
import WorkflowDashboard from '@/pages/WorkflowDashboard'
import MakerQueue from '@/pages/MakerQueue'
import CheckerQueue from '@/pages/CheckerQueue'
import ClaimsOfficerQueue from '@/pages/ClaimsOfficerQueue'
import FraudQueue from '@/pages/FraudQueue'
import ProviderApprovals from '@/pages/ProviderApprovals'
import UserManagement from '@/pages/UserManagement'
import Roles from '@/pages/Roles'
import Permissions from '@/pages/Permissions'
import ActivityLogs from '@/pages/ActivityLogs'
import Reports from '@/pages/Reports'
import ProviderScorecard from '@/pages/ProviderScorecard'
import PreAuth from '@/pages/PreAuth'
import Profile from '@/pages/Profile'
import Settings from '@/pages/Settings'
import TwoFactorSetup from '@/pages/TwoFactorSetup'
import Branches from '@/pages/Branches'
import TermsOfService from '@/pages/TermsOfService'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import DocumentClassifierEditor from '@/pages/DocumentClassifierEditor'
import UnknownDocuments from '@/pages/UnknownDocuments'
import UnknownDocumentReview from '@/pages/UnknownDocumentReview'
import ScanStation from '@/pages/ScanStation'
import PolicyPlans from '@/pages/PolicyPlans'
import MLLabelling from '@/pages/MLLabelling'
import ZoneAnalytics from '@/pages/ZoneAnalytics'
import ScanMeteringDashboard from '@/pages/ScanMeteringDashboard'

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
            <Layout />
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
