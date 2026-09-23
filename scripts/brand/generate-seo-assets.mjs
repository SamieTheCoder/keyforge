// SPDX-License-Identifier: AGPL-3.0-only
//
// Regenerates the site's share images and PNG icons from the brand SVGs in
// public/brand. Run with: node scripts/brand/generate-seo-assets.mjs
// Requires sharp (npm i -D sharp) for SVG rasterisation.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const brand = path.join(root, 'public', 'brand');

const FONT = `'Segoe UI', Inter, system-ui, -apple-system, sans-serif`;
const MONO = `Consolas, 'Cascadia Mono', ui-monospace, monospace`;

// Inner content of keyforge-icon.svg (the 512 tile), nested into the OG art.
async function iconInner() {
  const svg = await readFile(path.join(brand, 'keyforge-icon.svg'), 'utf8');
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return inner;
}

function wordmark(x, y, size, fill) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="700" letter-spacing="-2" fill="${fill}">key<tspan fill="#00c9c7">z</tspan>forge</text>`;
}

function ogShell({ inner, texts }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg1" cx="1050" cy="40" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#14ffec" stop-opacity=".28"/>
      <stop offset=".5" stop-color="#00c9c7" stop-opacity=".10"/>
      <stop offset="1" stop-color="#0d7377" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bg2" cx="80" cy="600" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#14ffec" stop-opacity=".20"/>
      <stop offset=".5" stop-color="#00c9c7" stop-opacity=".08"/>
      <stop offset="1" stop-color="#0d7377" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#121414"/>
  <rect width="1200" height="630" fill="url(#bg1)"/>
  <rect width="1200" height="630" fill="url(#bg2)"/>
  <svg x="84" y="135" width="360" height="360" viewBox="0 0 512 512">${inner}</svg>
  ${texts}
</svg>`;
}

function defaultTexts() {
  return `
  ${wordmark(500, 250, 104, '#f2f5f5')}
  <text x="504" y="330" font-family="${FONT}" font-size="36" fill="#9aa5a5">Flash, configure and monitor</text>
  <text x="504" y="378" font-family="${FONT}" font-size="36" fill="#9aa5a5">open-source FIDO2 security keys</text>
  <text x="504" y="426" font-family="${FONT}" font-size="36" fill="#9aa5a5">from the browser.</text>
  <text x="504" y="500" font-family="${MONO}" font-size="32" fill="#14ffec">keyzforge.xyz</text>`;
}

function pageTexts(heading, sub1, sub2, pathLabel) {
  return `
  <text x="500" y="225" font-family="${FONT}" font-size="88" font-weight="700" letter-spacing="-2" fill="#f2f5f5">${heading}</text>
  <text x="504" y="300" font-family="${FONT}" font-size="34" fill="#9aa5a5">${sub1}</text>
  <text x="504" y="352" font-family="${FONT}" font-size="34" fill="#9aa5a5">${sub2}</text>
  <text x="504" y="426" font-family="${MONO}" font-size="32" fill="#14ffec">${pathLabel}</text>
  ${wordmark(500, 520, 56, '#5b6666')}`;
}

const { default: sharp } = await import('sharp');

const inner = await iconInner();
const MID = '&#183;';
const jobs = [
  [
    'public/og/og-default.png',
    ogShell({ inner, texts: defaultTexts() }),
    1200,
    630,
  ],
  [
    'public/og/og-flash.png',
    ogShell({
      inner,
      texts: pageTexts(
        'Flash firmware',
        `ESP32-S3 ${MID} ESP32-S2 ${MID} RP2040 ${MID} RP2350`,
        'Write Keyzforge firmware from the browser.',
        'keyzforge.xyz/flash'
      ),
    }),
    1200,
    630,
  ],
  [
    'public/og/og-configure.png',
    ogShell({
      inner,
      texts: pageTexts(
        'Configure a key',
        'LED, USB identity and security options,',
        'confirmed with the BOOT button.',
        'keyzforge.xyz/configure'
      ),
    }),
    1200,
    630,
  ],
  [
    'public/og/og-passkeys.png',
    ogShell({
      inner,
      texts: pageTexts(
        'Passkeys and PIN',
        'Set your PIN and manage the passkeys',
        'stored on your key.',
        'keyzforge.xyz/passkeys'
      ),
    }),
    1200,
    630,
  ],
  [
    'public/og/og-monitor.png',
    ogShell({
      inner,
      texts: pageTexts(
        'Serial monitor',
        'Read boot logs and see the moment',
        'your board becomes a security key.',
        'keyzforge.xyz/monitor'
      ),
    }),
    1200,
    630,
  ],
  [
    'public/og/og-how-it-works.png',
    ogShell({
      inner,
      texts: pageTexts(
        'How it works',
        'Open firmware, browser flashing and',
        'passkeys, explained with drawings.',
        'keyzforge.xyz/how-it-works'
      ),
    }),
    1200,
    630,
  ],
];

for (const [rel, svg, w, h] of jobs) {
  const out = path.join(root, rel);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(w, h, { fit: 'fill' })
    .png()
    .toFile(out);
  console.log('wrote', rel);
}

const iconSvg = await readFile(path.join(brand, 'keyforge-icon.svg'), 'utf8');
for (const [rel, size] of [
  ['public/icons/apple-touch-icon.png', 180],
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
]) {
  const out = path.join(root, rel);
  await sharp(Buffer.from(iconSvg), { density: 144 })
    .resize(size, size, { fit: 'contain', background: '#1a1d1d' })
    .png()
    .toFile(out);
  console.log('wrote', rel);
}
