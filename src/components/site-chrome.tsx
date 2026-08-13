'use client';

import { GithubLogo, List, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { SITE } from '@/lib/site';
import { cn } from '@/lib/utils';

export const NAV = [
  { href: '/flash', label: 'Flash' },
  { href: '/configure', label: 'Configure' },
  { href: '/passkeys', label: 'Passkeys' },
  { href: '/monitor', label: 'Monitor' },
  { href: '/how-it-works', label: 'How it works' },
] as const;

const REPO_URL = SITE.repoUrl;

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-[10px]" aria-label="Keyforge home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-[10px] px-3 py-2 text-sm transition-colors',
                  active ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg'
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            className="grid size-9 place-items-center rounded-[10px] text-muted transition-colors hover:bg-accent-soft hover:text-fg"
          >
            <GithubLogo size={18} weight="bold" />
          </a>
          <ThemeToggle />
          <button
            type="button"
            className="grid size-9 place-items-center rounded-[10px] text-muted hover:text-fg md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line px-4 py-2 md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-[10px] px-3 py-2.5 text-sm text-muted hover:text-fg"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-[42ch] text-muted">
            Open-source tools for pico-fido security keys. Everything runs in your browser and talks
            to your hardware directly.
          </p>
        </div>
        <div>
          <p className="mb-2 font-medium">Tools</p>
          <ul className="space-y-1.5 text-muted">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:text-fg">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 font-medium">Project</p>
          <ul className="space-y-1.5 text-muted">
            <li>
              <Link href="/privacy" className="hover:text-fg">
                Privacy
              </Link>
            </li>
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                Source code
              </a>
            </li>
            <li>
              <a href={`${REPO_URL}/tree/main/firmware`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                Firmware source
              </a>
            </li>
            <li>
              <a href="https://github.com/polhenarejos/pico-fido" target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                pico-fido upstream
              </a>
            </li>
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-7xl px-4 pb-8 text-xs text-faint sm:px-6">
        Free software under AGPL-3.0. Not affiliated with PicoKeys, Espressif or Raspberry Pi.
      </p>
    </footer>
  );
}
