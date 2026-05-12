import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ProviderApprovalGate } from './ProviderApprovalGate'
import { useThemeStore } from '@/store/themeStore'

export function Layout() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useThemeStore()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          <ProviderApprovalGate>
            <Outlet />
          </ProviderApprovalGate>
        </main>
      </div>
    </div>
  )
}
