// SPDX-License-Identifier: AGPL-3.0-only
// Browser-side release listing (GitHub API, CORS-enabled) and firmware download
// through the same-origin /api/firmware route.

import type { GithubRelease } from './firmware';

const cache = new Map<string, Promise<GithubRelease[]>>();

export function fetchReleases(repo: string): Promise<GithubRelease[]> {
  let p = cache.get(repo);
  if (!p) {
    p = fetch(`https://api.github.com/repos/${repo}/releases?per_page=8`, {
      headers: { Accept: 'application/vnd.github+json' },
    }).then(async (r) => {
      if (r.status === 403)
        throw new Error(
          'GitHub rate limit reached. Wait a few minutes or pick a local file.'
        );
      if (!r.ok) throw new Error(`GitHub returned ${r.status} for ${repo}.`);
      return (await r.json()) as GithubRelease[];
    });
    p.catch(() => cache.delete(repo));
    cache.set(repo, p);
  }
  return p;
}

export async function downloadFirmware(
  repo: string,
  tag: string,
  name: string,
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const q = new URLSearchParams({ repo, tag, name });
  const res = await fetch(`/api/firmware?${q}`);
  if (!res.ok || !res.body)
    throw new Error(
      `Download failed: ${(await res.text().catch(() => '')) || res.status}`
    );
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
    done += value.byteLength;
    onProgress?.(done, total);
  }
  const out = new Uint8Array(done);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
