import { Flasher } from '@/components/flasher';
import { JsonLd } from '@/components/json-ld';
import { PageIntro } from '@/components/log';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';

const DESCRIPTION =
  'Flash Keyzforge firmware onto ESP32-S3, ESP32-S2, RP2040 and RP2350 boards from your browser. Free, open-source, no installs.';

export const metadata = pageMetadata({
  path: '/flash',
  title: 'Flash firmware',
  description: DESCRIPTION,
  image: '/og/og-flash.png',
  imageAlt:
    'Flash Keyzforge firmware onto ESP32, RP2040 and RP2350 boards from the browser',
});

const JSON_LD = webPageJsonLd({
  path: '/flash',
  name: 'Flash firmware | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-08-24',
  dateModified: '2026-10-05',
  crumb: 'Flash firmware',
  extra: siteJsonLd(),
});

export default function FlashPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <JsonLd data={JSON_LD} />
      <PageIntro
        title="Flash firmware"
        text="Pick your chip, choose a firmware release, and write it. Files are checked against the chip before anything is written."
      />
      <Flasher />
    </div>
  );
}
