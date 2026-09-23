import type { Metadata } from 'next';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Open-source licenses',
  description:
    'Licenses of Keyforge and the open-source software it is built on.',
};

// Standard open-source notices, as every app ships them. The AGPL and MIT licenses ask that
// copyright notices travel with the software; this page is where they live on the website.
const NOTICES: {
  name: string;
  license: string;
  holder: string;
  url: string;
  use: string;
}[] = [
  {
    name: 'Keyforge',
    license: 'AGPL-3.0-only',
    holder: 'Keyforge contributors',
    url: SITE.repoUrl,
    use: 'This website, its WebUSB / Web Serial libraries, firmware patches and build pipeline.',
  },
  {
    name: 'pico-fido and pico-keys-sdk',
    license: 'AGPL-3.0',
    holder: 'Pol Henarejos',
    url: 'https://github.com/polhenarejos/pico-fido',
    use: 'Firmware code base that Keyforge firmware is built from.',
  },
  {
    name: 'picoflash',
    license: 'MIT',
    holder: 'Piers Finlayson',
    url: 'https://github.com/piersfinlayson/picoflash',
    use: 'Reference for the PICOBOOT flashing sequence.',
  },
  {
    name: 'esptool-js',
    license: 'Apache-2.0',
    holder: 'Espressif Systems',
    url: 'https://github.com/espressif/esptool-js',
    use: 'ESP32 flashing.',
  },
  {
    name: 'hairline',
    license: 'MIT',
    holder: 'Lucas Marques',
    url: 'https://github.com/lucasmarkes/hairline',
    use: 'Line drawings.',
  },
  {
    name: 'Phosphor Icons',
    license: 'MIT',
    holder: 'Phosphor Icons',
    url: 'https://phosphoricons.com',
    use: 'Icons.',
  },
  {
    name: 'Geist',
    license: 'SIL OFL 1.1',
    holder: 'Vercel',
    url: 'https://vercel.com/font',
    use: 'Fonts.',
  },
  {
    name: 'Next.js, React',
    license: 'MIT',
    holder: 'Vercel, Meta',
    url: 'https://nextjs.org',
    use: 'Web framework.',
  },
];

export default function LicensesPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
        Open-source licenses
      </h1>
      <p className="text-muted mt-4 leading-relaxed">
        Keyforge is free software under the GNU Affero General Public License
        v3.0. You can use, study, change and share it. If you run a changed
        version for others, share your source too. The full source of this site
        and of every firmware release is on{' '}
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
      <ul className="divide-line border-line mt-10 divide-y rounded-[16px] border">
        {NOTICES.map((n) => (
          <li
            key={n.name}
            className="grid gap-1 p-5 sm:grid-cols-[1fr_auto] sm:gap-4"
          >
            <div>
              <a
                href={n.url}
                className="hover:text-accent font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                {n.name}
              </a>
              <p className="text-muted mt-1 text-sm">{n.use}</p>
              <p className="text-faint mt-1 text-xs">Copyright {n.holder}</p>
            </div>
            <span className="border-line text-muted self-start rounded-full border px-2.5 py-0.5 font-mono text-xs">
              {n.license}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-faint mt-8 text-sm">
        Keyforge is an independent project, not affiliated with or endorsed by
        Espressif, Raspberry Pi or the FIDO Alliance.
      </p>
    </article>
  );
}
