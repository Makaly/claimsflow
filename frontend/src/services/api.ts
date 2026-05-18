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

// Retry once on network errors / 502-504 — covers Render free-tier
// cold-start, where the first request after a long idle returns a
// CORS-headerless 502 from the edge while the container boots.
attachRetryInterceptor(api)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Skip logout logic for the logout endpoint itself to avoid an infinite
      // cycle (expired token → 401 on /auth/logout → tries logout again → …).
      const url: string = error.config?.url ?? ''
      if (!url.includes('/auth/logout') && !url.includes('/auth/login')) {
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
