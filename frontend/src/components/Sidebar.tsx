import { NavLink, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import {
  LayoutDashboard, FileText, Building2, Upload, GitBranch,
  UserCheck, UserCog, Users, Activity, BarChart3, Shield,
  Settings, ChevronLeft, ChevronRight, Network, AlertOctagon,
  KeyRound, ShieldCheck, FileQuestion, Scale, CreditCard, Clock, SlidersHorizontal,
  ScanLine,
} from 'lucide-react'
import { useUnknownDocCount } from '@/hooks/useUnknownDocCount'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/store/themeStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

type Role =
  | 'admin'
  | 'supervisor'
  | 'claims_officer'
  | 'checker'
  | 'fraud_officer'
  | 'provider_admin'
  | 'provider_user'

type NavItem =
  | { type: 'separator'; name: string; roles: Role[] }
  | { type?: undefined; name: string; href: string; icon: any; roles: Role[] }

const CIC_STAFF: Role[] = ['admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer']
const ALL_ROLES: Role[] = [...CIC_STAFF, 'provider_admin', 'provider_user']

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ALL_ROLES },
  { name: 'Claims', href: '/claims', icon: FileText, roles: ALL_ROLES },
  // Providers directory is a CIC-internal tool.
  { name: 'Providers', href: '/providers', icon: Building2, roles: ['admin', 'supervisor', 'checker', 'fraud_officer'] },
  // Provider admins manage their own branches; CIC staff see everything.
  { name: 'Branches', href: '/branches', icon: Network, roles: [...CIC_STAFF, 'provider_admin'] },
  // Only people who actually upload claims.
  { name: 'Batch Upload', href: '/batch-upload', icon: Upload, roles: ['admin', 'claims_officer', 'provider_admin', 'provider_user'] },
  { type: 'separator', name: 'Workflow', roles: CIC_STAFF },
  { name: 'Workflow', href: '/workflow', icon: GitBranch, roles: CIC_STAFF },
  { name: 'Maker Queue', href: '/workflow/maker', icon: UserCheck, roles: ['admin', 'supervisor', 'claims_officer'] },
  { name: 'Checker Queue', href: '/workflow/checker', icon: UserCog, roles: ['admin', 'supervisor', 'checker'] },
  { name: 'Fraud Queue', href: '/workflow/fraud', icon: AlertOctagon, roles: ['admin', 'supervisor', 'fraud_officer', 'claims_officer'] },
  { name: 'Claims Aging', href: '/workflow/aging', icon: Clock, roles: CIC_STAFF },
  { name: 'Scan Station', href: '/scan-station', icon: ScanLine, roles: ['admin', 'supervisor', 'claims_officer', 'checker'] },
  { name: 'Pre-Auth', href: '/pre-auth', icon: ShieldCheck, roles: ['admin', 'supervisor', 'claims_officer', 'provider_admin', 'provider_user'] },
  { name: 'Provider Approvals', href: '/provider-approvals', icon: Shield, roles: ['admin', 'supervisor'] },
  { name: 'Appeals', href: '/appeals', icon: Scale, roles: [...CIC_STAFF, 'provider_admin', 'provider_user'] },
  { type: 'separator', name: 'Finance', roles: ['admin', 'supervisor'] as Role[] },
  { name: 'Payment Settlement', href: '/payment', icon: CreditCard, roles: ['admin', 'supervisor'] },
  { type: 'separator', name: 'Admin', roles: ['admin', 'supervisor'] },
  { name: 'Users', href: '/users', icon: Users, roles: ['admin', 'supervisor'] },
  { name: 'Roles', href: '/roles', icon: ShieldCheck, roles: ['admin', 'supervisor'] },
  { name: 'Permissions', href: '/permissions', icon: KeyRound, roles: ['admin', 'supervisor'] },
  { name: 'Policy Plans', href: '/policy-plans', icon: Shield, roles: ['admin', 'supervisor'] },
  { name: 'Activity Logs', href: '/activity-logs', icon: Activity, roles: ['admin', 'supervisor'] },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'supervisor'] },
  { name: 'Provider Scorecard', href: '/provider-scorecard', icon: BarChart3, roles: ['admin', 'supervisor'] },
  { name: 'Unknown Docs', href: '/unknown-documents', icon: FileQuestion, roles: ['admin', 'supervisor'] },
  { name: 'System Config', href: '/system-config', icon: SlidersHorizontal, roles: ['admin'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin', 'supervisor'] },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useThemeStore()
  const { user } = useAuthStore()
  const role = (user?.role as Role | undefined)
  const location = useLocation()
  const unknownDocCount = useUnknownDocCount()

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname, setMobileSidebarOpen])

  const visibleItems = navigation.filter(item =>
    role ? item.roles.includes(role) : false
  )

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed md:relative inset-y-0 left-0 z-40 flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-300 shrink-0',
          sidebarCollapsed ? 'w-16' : 'w-64',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            C
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold">ClaimFlow</span>
              <span className="text-[10px] text-muted-foreground">Medical Automation</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-1 px-2">
            {visibleItems.map((item, i) => {
              if ('type' in item && item.type === 'separator') {
                return (
                  <div key={`sep-${i}`} className="py-2">
                    <Separator />
                    {!sidebarCollapsed && (
                      <span className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {item.name}
                      </span>
                    )}
                  </div>
                )
              }

              const badge = item.href === '/unknown-documents' && unknownDocCount > 0
                ? unknownDocCount
                : null

              const link = (
                <NavLink
                  key={item.href}
                  to={item.href!}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )
                  }
                >
                  <div className="relative">
                    <item.icon className="h-4 w-4 shrink-0" />
                    {badge && sidebarCollapsed && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </div>
                  {!sidebarCollapsed && <span className="flex-1">{item.name}</span>}
                  {!sidebarCollapsed && badge && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </NavLink>
              )

              if (sidebarCollapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.name}</TooltipContent>
                  </Tooltip>
                )
              }

              return link
            })}
          </nav>
        </ScrollArea>

        {/* Collapse toggle */}
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="w-full"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
