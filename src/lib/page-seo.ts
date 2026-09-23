// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared builders for per-page SEO: metadata (title, description, canonical,
// hreflang, Open Graph, Twitter) and JSON-LD (WebPage + BreadcrumbList).
// Every route page uses these so tags stay consistent.

import type { Metadata } from 'next';
import { SITE } from '@/lib/site';

export function pageMetadata({
  path,
  title,
  absoluteTitle,
  description,
  image = '/og/og-default.png',
  imageAlt,
  robots,
}: {
  /** Route path, e.g. '/flash'. */
  path: string;
  /** Short title without the site suffix. */
  title: string;
  /** Full title that bypasses the layout template (homepage). */
  absoluteTitle?: string;
  description: string;
  /** 1200x630 share image under public/. */
  image?: string;
  imageAlt?: string;
  robots?: Metadata['robots'];
}): Metadata {
  const fullTitle = absoluteTitle ?? `${title} | ${SITE.name}`;
  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    alternates: { canonical: path, languages: { en: path } },
    robots: robots ?? { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: SITE.name,
      type: 'website',
      images: [
        { url: image, width: 1200, height: 630, alt: imageAlt ?? fullTitle },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image],
    },
  };
}

export function webPageJsonLd({
  path,
  name,
  description,
  datePublished,
  dateModified,
  crumb,
  extra = [],
}: {
  path: string;
  name: string;
  description: string;
  datePublished: string;
  dateModified: string;
  /** Breadcrumb label, e.g. 'Flash firmware'. */
  crumb: string;
  extra?: Array<Record<string, unknown>>;
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${SITE.url}${path}`,
        url: `${SITE.url}${path}`,
        name,
        description,
        inLanguage: 'en',
        datePublished,
        dateModified,
        isPartOf: { '@id': `${SITE.url}/#website` },
        breadcrumb: { '@id': `${SITE.url}${path}#breadcrumb` },
        publisher: {
          '@type': 'Organization',
          name: SITE.name,
          url: SITE.url,
          logo: {
            '@type': 'ImageObject',
            url: `${SITE.url}/brand/keyforge-logo-on-light.svg`,
          },
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${SITE.url}${path}#breadcrumb`,
        itemListElement:
          path === '/'
            ? [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: 'Home',
                  item: SITE.url,
                },
              ]
            : [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: 'Home',
                  item: SITE.url,
                },
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: crumb,
                  item: `${SITE.url}${path}`,
                },
              ],
      },
      ...extra,
    ],
  };
}

/** Nodes every page references: the site and the publisher. */
export function siteJsonLd() {
  return [
    {
      '@type': 'WebSite',
      '@id': `${SITE.url}/#website`,
      url: SITE.url,
      name: SITE.name,
      inLanguage: 'en',
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE.url}/#organization`,
      name: SITE.name,
      url: SITE.url,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE.url}/brand/keyforge-logo-on-light.svg`,
      },
    },
  ];
}
