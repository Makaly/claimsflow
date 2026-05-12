import { create } from 'zustand'

interface ThemeState {
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  mobileSidebarOpen: boolean
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleMobileSidebar: () => void
  setMobileSidebarOpen: (open: boolean) => void
}

export const useThemeStore = create<ThemeState>((set) => {
  const saved = localStorage.getItem('theme') as 'light' | 'dark' | null
  const initial = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', initial === 'dark')

  return {
    theme: initial,
    sidebarCollapsed: false,
    mobileSidebarOpen: false,

    toggleTheme: () =>
      set((state) => {
        const next = state.theme === 'light' ? 'dark' : 'light'
        localStorage.setItem('theme', next)
        document.documentElement.classList.toggle('dark', next === 'dark')
        return { theme: next }
      }),

    toggleSidebar: () =>
      set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    toggleMobileSidebar: () =>
      set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),

    setMobileSidebarOpen: (open: boolean) =>
      set({ mobileSidebarOpen: open }),
  }
})
