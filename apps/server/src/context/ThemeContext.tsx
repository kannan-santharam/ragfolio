'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = 'ragfolio-theme';

/**
 * Runs before paint (injected in <head>) so the first frame is already in the
 * right theme — no white flash on a dark-mode reload.
 */
export const themeBootstrapScript = `
(function () {
  try {
    // An embedding page can pin the theme with ?theme=dark|light, so the widget
    // matches the site around it. A pinned theme is not saved.
    var forced = new URLSearchParams(window.location.search).get('theme');
    var saved = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = forced === 'light' || forced === 'dark'
      ? forced
      : saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Matches the bootstrap script's default; the effect below reconciles on mount.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((previous) => {
      const next: Theme = previous === 'dark' ? 'light' : 'dark';
      const root = document.documentElement;
      root.classList.remove(previous);
      root.classList.add(next);
      root.style.colorScheme = next;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* private browsing */
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
