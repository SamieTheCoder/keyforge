import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { THEME_SCRIPT } from '@/components/theme-toggle';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://keyzforge.xyz'),
  title: {
    default: 'Keyzforge: build your own FIDO2 security key',
    template: '%s | Keyzforge',
  },
  description:
    'Flash, configure and monitor open-source FIDO2 security keys on ESP32-S3, RP2040 and RP2350, straight from the browser.',
  applicationName: 'Keyzforge',
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: '/brand/keyforge-icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Keyzforge',
    description:
      'Flash, configure and monitor open-source FIDO2 security keys from the browser.',
    url: 'https://keyzforge.xyz',
    siteName: 'Keyzforge',
    type: 'website',
    images: [
      {
        url: '/og/og-default.png',
        width: 1200,
        height: 630,
        alt: 'Keyzforge: open-source FIDO2 security keys you build yourself',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Keyzforge',
    description:
      'Flash, configure and monitor open-source FIDO2 security keys from the browser.',
    images: ['/og/og-default.png'],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#121414' },
    { media: '(prefers-color-scheme: light)', color: '#f3f6f6' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className="relative flex min-h-dvh flex-col"
        suppressHydrationWarning
      >
        <div
          aria-hidden
          className="bg-mesh pointer-events-none fixed inset-x-0 top-0 -z-10 h-[720px] [mask-image:linear-gradient(to_bottom,#000_40%,transparent)]"
        />
        <div
          aria-hidden
          className="bg-grid pointer-events-none fixed inset-0 -z-10"
        />
        <a
          href="#main"
          className="bg-accent text-accent-ink sr-only rounded-[10px] px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
