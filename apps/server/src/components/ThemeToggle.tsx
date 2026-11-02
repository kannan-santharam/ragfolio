'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  // Hidden when the embedding page pins the theme with ?theme=, so the chat
  // cannot drift away from the site around it.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    setPinned(new URLSearchParams(window.location.search).has('theme'));
  }, []);

  if (pinned) return null;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-title)]"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
