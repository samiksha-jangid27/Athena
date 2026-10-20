import { useEffect, useState } from 'react'

const KEY = 'athena.theme'

function readTheme() {
  try {
    return localStorage.getItem(KEY) || 'system'
  } catch {
    return 'system'
  }
}

// 'system' follows the OS; 'light'/'dark' are explicit choices.
export function useTheme() {
  const [theme, setTheme] = useState(readTheme)

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }, [theme])

  const cycle = () => setTheme((current) => ({ system: 'light', light: 'dark', dark: 'system' })[current])
  return { theme, cycle }
}
