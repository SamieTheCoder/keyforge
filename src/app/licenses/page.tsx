import { JsonLd } from '@/components/json-ld';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';
import { SITE } from '@/lib/site';

const DESCRIPTION =
  'Keyzforge is free software under the GNU AGPL-3.0, built on open-source projects. Every license and upstream source, listed.';

export const metadata = pageMetadata({
  path: '/licenses',
  title: 'Licenses',
  description: DESCRIPTION,
});

// Kept short. AGPL / MIT only require that the notices travel with the software, not long blurbs.
const BUILT_ON = [
  {
    name: 'pico-fido, pico-keys-sdk',
    license: 'AGPL-3.0',
    url: 'https://github.com/polhenarejos/pico-fido',
  },
  {
    name: 'picoflash',
    license: 'MIT',
    url: 'https://github.com/piersfinlayson/picoflash',
  },
  {
    name: 'esptool-js',
    license: 'Apache-2.0',
    url: 'https://github.com/espressif/esptool-js',
  },
  {
    name: 'hairline',
    license: 'MIT',
    url: 'https://github.com/lucasmarkes/hairline',
  },
  { name: 'Phosphor Icons', license: 'MIT', url: 'https://phosphoricons.com' },
  {
    name: 'Next.js, React, Geist',
    license: 'MIT / OFL',
    url: 'https://nextjs.org',
  },
];

const JSON_LD = webPageJsonLd({
  path: '/licenses',
  name: 'Licenses | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-09-23',
  dateModified: '2026-10-05',
  crumb: 'Licenses',
  extra: siteJsonLd(),
});

export default function LicensesPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <JsonLd data={JSON_LD} />
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
        Licenses
      </h1>
      <p className="text-muted mt-4 leading-relaxed">
        Keyzforge is free software under the GNU AGPL-3.0. Use it, study it,
        change it, share it. The full source of this site and every firmware
        release is on{' '}
        <a
          href={SITE.repoUrl}
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        .
      </p>
      <h2 className="text-muted mt-10 text-sm font-medium tracking-wide uppercase">
        Built on open source
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {BUILT_ON.map((n) => (
          <li key={n.name}>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-line hover:border-line-strong hover:text-fg text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-colors"
            >
              {n.name}
              <span className="text-faint font-mono text-[11px]">
                {n.license}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-faint mt-8 text-sm">
        Independent project, not affiliated with Espressif, Raspberry Pi or the
        FIDO Alliance.
      </p>
    </article>
  );
}
