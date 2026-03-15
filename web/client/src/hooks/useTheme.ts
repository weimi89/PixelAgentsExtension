import { useState, useCallback, useEffect } from 'react'

type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'pixel-agents-theme'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch { /* ignore */ }
  return 'dark'
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  // 初始化時套用主題
  useEffect(() => {
    applyTheme(theme)
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    applyTheme(newTheme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme)
    } catch { /* ignore */ }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, setTheme, toggleTheme } as const
}

export type { Theme }
