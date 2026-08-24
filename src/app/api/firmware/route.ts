// SPDX-License-Identifier: AGPL-3.0-only
//
// GET /api/firmware?repo=<owner/name>&tag=<tag>&name=<asset>
//
// GitHub's release-asset CDN sends no CORS headers, so the browser cannot
// download firmware directly. This route fetches one release asset from an
// allowlisted firmware repository and streams it back.
//
// It is deliberately not an open proxy:
//  - repo must be one of FIRMWARE_SOURCES,
//  - tag and name are restricted to safe characters and the URL is built here
//    (host fixed to github.com), so no caller-supplied URL is ever fetched,
//  - only .bin / .uf2 files, at most 16 MiB.
// No authentication is needed: it only serves public open-source releases.

import { FIRMWARE_SOURCES } from '@/lib/firmware';

const ALLOWED_REPOS = new Set(FIRMWARE_SOURCES.map((s) => s.repo));
const SAFE = /^[A-Za-z0-9._+-]{1,128}$/;
const MAX_BYTES = 16 * 1024 * 1024;

function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const repo = url.searchParams.get('repo') ?? '';
  const tag = url.searchParams.get('tag') ?? '';
  const name = url.searchParams.get('name') ?? '';

  if (!ALLOWED_REPOS.has(repo)) return fail(400, 'Unknown firmware repository.');
  if (!SAFE.test(tag) || !SAFE.test(name)) return fail(400, 'Invalid release tag or file name.');
  if (!/\.(bin|uf2)$/i.test(name)) return fail(400, 'Only .bin and .uf2 firmware files are served.');

  const upstream = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  let res: Response;
  try {
    res = await fetch(upstream, {
      redirect: 'follow',
      headers: { 'User-Agent': 'keyforge.tech firmware fetch' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail(502, 'Could not reach GitHub.');
  }
  if (!res.ok) return fail(res.status === 404 ? 404 : 502, `GitHub returned ${res.status}.`);

  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return fail(413, 'Firmware file is unexpectedly large.');

  // Firmware images are ~1 MiB, so buffer once and send a complete body.
  // (Piping the upstream stream through a TransformStream stalled mid-file.)
  let body: ArrayBuffer;
  try {
    body = await res.arrayBuffer();
  } catch {
    return fail(502, 'Download from GitHub was interrupted.');
  }
  if (body.byteLength > MAX_BYTES) return fail(413, 'Firmware file is unexpectedly large.');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
