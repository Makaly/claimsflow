import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { useAuthStore } from '@/store/authStore'
import { useClaimsStore } from '@/store/claimsStore'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import ForgotPassword from '@/pages/ForgotPassword'
import Dashboard from '@/pages/Dashboard'
import Claims from '@/pages/Claims'
import Providers from '@/pages/Providers'
import Documents from '@/pages/Documents'
import BatchUpload from '@/pages/BatchUpload'
import WorkflowDashboard from '@/pages/WorkflowDashboard'
import MakerQueue from '@/pages/MakerQueue'
import CheckerQueue from '@/pages/CheckerQueue'
import FraudQueue from '@/pages/FraudQueue'
import ProviderApprovals from '@/pages/ProviderApprovals'
import UserManagement from '@/pages/UserManagement'
import Roles from '@/pages/Roles'
import Permissions from '@/pages/Permissions'
import ActivityLogs from '@/pages/ActivityLogs'
import Reports from '@/pages/Reports'
import Profile from '@/pages/Profile'
import Settings from '@/pages/Settings'
import TwoFactorSetup from '@/pages/TwoFactorSetup'
import Branches from '@/pages/Branches'
import TermsOfService from '@/pages/TermsOfService'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import DocumentClassifierEditor from '@/pages/DocumentClassifierEditor'
import UnknownDocuments from '@/pages/UnknownDocuments'

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
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (allowedRoles && allowedRoles.length > 0) {
    const role = user?.role
    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to="/" replace />
    }
  }
  return <>{children}</>
}

const CIC_STAFF = ['admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer']
const ADMIN_ONLY = ['admin', 'supervisor']

function AppRoutes() {
  const { isAuthenticated } = useAuthStore()
  const { fetchFromServer, serverLoaded } = useClaimsStore()

  // Load claims from server once after login
  useEffect(() => {
    if (isAuthenticated && !serverLoaded) {
      fetchFromServer()
    }
  }, [isAuthenticated])

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Register />}
      />
      <Route
        path="/forgot-password"
        element={isAuthenticated ? <Navigate to="/" replace /> : <ForgotPassword />}
      />
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
        <Route path="/providers" element={<ProtectedRoute allowedRoles={['admin', 'supervisor', 'checker', 'fraud_officer']}><Providers /></ProtectedRoute>} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/batch-upload" element={<BatchUpload />} />
        <Route path="/workflow" element={<ProtectedRoute allowedRoles={CIC_STAFF}><WorkflowDashboard /></ProtectedRoute>} />
        <Route path="/workflow/maker" element={<ProtectedRoute allowedRoles={['admin','supervisor','claims_officer']}><MakerQueue /></ProtectedRoute>} />
        <Route path="/workflow/checker" element={<ProtectedRoute allowedRoles={['admin','supervisor','checker']}><CheckerQueue /></ProtectedRoute>} />
        <Route path="/workflow/fraud" element={<ProtectedRoute allowedRoles={['admin','supervisor','fraud_officer','claims_officer']}><FraudQueue /></ProtectedRoute>} />
        <Route path="/provider-approvals" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><ProviderApprovals /></ProtectedRoute>} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/users" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><UserManagement /></ProtectedRoute>} />
        <Route path="/roles" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Roles /></ProtectedRoute>} />
        <Route path="/permissions" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Permissions /></ProtectedRoute>} />
        <Route path="/activity-logs" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><ActivityLogs /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Reports /></ProtectedRoute>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<ProtectedRoute allowedRoles={ADMIN_ONLY}><Settings /></ProtectedRoute>} />
        <Route path="/settings/document-classifiers/:id" element={<ProtectedRoute allowedRoles={['admin']}><DocumentClassifierEditor /></ProtectedRoute>} />
        <Route path="/unknown-documents" element={<ProtectedRoute allowedRoles={['admin','supervisor']}><UnknownDocuments /></ProtectedRoute>} />
        <Route path="/2fa-setup" element={<TwoFactorSetup />} />
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
