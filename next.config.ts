import type { NextConfig } from 'next';

/**
 * Security headers for every response.
 *
 * Keyforge talks to USB hardware, so the CSP is enforced (not report-only):
 *  - connect-src allows only this origin and the GitHub releases API (release
 *    listing). Firmware files are downloaded through /api/firmware, a
 *    same-origin route restricted to allowlisted repos, so a compromised
 *    dependency cannot exfiltrate data to arbitrary hosts.
 *  - Permissions-Policy grants WebUSB and Web Serial to this origin only.
 *  - script-src needs 'unsafe-inline' for Next's inline hydration script;
 *    'unsafe-eval' is added only in development (React Refresh).
 */
const isDev = process.env.NODE_ENV !== 'production';

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    'https://api.github.com',
    ...(isDev ? ['ws:'] : []),
  ].join(' '),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'usb=(self), serial=(self), camera=(), microphone=(), geolocation=(), payment=()',
  },
  { key: 'Content-Security-Policy', value: CSP },
] as const;

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: [...SECURITY_HEADERS] },
      // Crawler directives as HTTP headers (meta robots tags are also set
      // per page; the most restrictive value wins). The /privacy rule is
      // last so it wins over the generic rule where both match.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'index, follow, max-image-preview:large' },
        ],
      },
      {
        source: '/privacy',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
