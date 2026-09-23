'use client';

import { Moon, Sun } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/** Inline script run before paint so the saved theme never flashes. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('kf-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Read the theme the pre-paint script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(currentTheme());
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('kf-theme', next);
    } catch {
      /* storage blocked */
    }
    setTheme(next);
  };

  const label =
    theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="text-muted hover:bg-accent-soft hover:text-fg grid size-9 place-items-center rounded-[10px] transition-colors"
    >
      {theme === 'light' ? (
        <Moon size={18} weight="bold" />
      ) : (
        <Sun size={18} weight="bold" />
      )}
    </button>
  );
}
