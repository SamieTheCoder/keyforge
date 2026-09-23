import { Configurator } from '@/components/configurator';
import { JsonLd } from '@/components/json-ld';
import { PageIntro } from '@/components/log';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';

const DESCRIPTION =
  'Set the LED pin, colour order and brightness, USB name and security options of a Keyzforge key over WebUSB. Reviewed before every write.';

export const metadata = pageMetadata({
  path: '/configure',
  title: 'Configure a key',
  description: DESCRIPTION,
  image: '/og/og-configure.png',
  imageAlt: 'Configure the LED, USB identity and security of a Keyzforge key',
});

const JSON_LD = webPageJsonLd({
  path: '/configure',
  name: 'Configure a key | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-08-28',
  dateModified: '2026-10-05',
  crumb: 'Configure a key',
  extra: siteJsonLd(),
});

export default function ConfigurePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <JsonLd data={JSON_LD} />
      <PageIntro
        title="Configure a key"
        text="Change the LED, USB identity and security settings of a running Keyzforge key. Every write is reviewed first and confirmed with the BOOT button."
      />
      <Configurator />
    </div>
  );
}
