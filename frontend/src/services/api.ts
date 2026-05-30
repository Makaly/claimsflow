import axios from 'axios'
import { attachRetryInterceptor } from './retry'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Send the HttpOnly auth cookie on every request automatically.
  // The browser handles this — no manual token attachment needed.
  withCredentials: true,
})

// Attach the Bearer token from localStorage on every request so auth works
// on mobile browsers and any browser with strict SameSite cookie policies
// that block cross-origin cookies (cookie alone is not reliable cross-origin).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && !config.headers['Authorization']) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Retry once on network errors / 502-504 — covers Render free-tier
// cold-start, where the first request after a long idle returns a
// CORS-headerless 502 from the edge while the container boots.
attachRetryInterceptor(api)

// Endpoints where a 401 does NOT mean "stale session, log the user out".
// Anonymous registration/verification/lookup endpoints commonly 401 on
// validation failure or duplicate-resource cases — bouncing the user to
// /login in those cases hides the actual server message and destroys
// whatever form state they just typed in.
const ANON_AUTH_PATHS = [
  '/auth/logout', '/auth/login',
  '/auth/register', '/auth/register-provider', '/auth/register-user-under-provider',
  '/auth/send-email-otp', '/auth/verify-email-otp',
  '/auth/forgot-password', '/auth/reset-password',
  '/auth/providers/approved',
]

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url ?? ''
      if (!ANON_AUTH_PATHS.some((p) => url.includes(p))) {
        // Import lazily to avoid circular dep: api ← authStore ← api.
        import('@/store/authStore').then(({ useAuthStore }) => {
          useAuthStore.getState().logout()
          window.location.replace('/login')
        })
      }
    }
    return Promise.reject(error)
  }
)

export default api
