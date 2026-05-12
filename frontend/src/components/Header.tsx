import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Moon, Sun, LogOut, User, Settings, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getInitials } from '@/lib/utils'
import { NotificationBell } from '@/components/NotificationBell'

export function Header() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuthStore()
  const { theme, toggleTheme, toggleMobileSidebar } = useThemeStore()
  const avatarUrl = user?.avatarUrl

  // Refresh the cached user on mount so avatar/name/etc. reflect the current DB row
  // (the login response is snapshotted — if the user updated their profile from
  // another device/browser, this pulls the authoritative values).
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch('/api/auth/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) { logout(); navigate('/login'); return null }
        return r.ok ? r.json() : null
      })
      .then((data) => { if (data && user) setUser({ ...user, ...data }) })
      .catch(() => { /* offline */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Hamburger — only on mobile */}
        <Button variant="ghost" size="icon" className="md:hidden" onClick={toggleMobileSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-base sm:text-lg font-semibold leading-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'User'}
          </h2>
          <p className="text-xs text-muted-foreground capitalize hidden sm:block">
            {user?.role?.replace('_', ' ')} Dashboard
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={user?.name || 'Profile'} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {getInitials(user?.name || 'U')}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <User className="mr-2 h-4 w-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
