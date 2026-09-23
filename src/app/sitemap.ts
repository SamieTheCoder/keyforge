import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

const ROUTES: Array<{
  path: string;
  changeFrequency: 'weekly' | 'monthly';
  priority: number;
}> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/flash', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/configure', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/passkeys', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/monitor', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/how-it-works', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/licenses', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${SITE.url}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
