import { JsonLd } from '@/components/json-ld';
import { PageIntro } from '@/components/log';
import { SerialMonitor } from '@/components/serial-monitor';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';

const DESCRIPTION =
  'Watch ESP32 boot logs over Web Serial and check whether your flash worked, with plain-language hints for common boot messages.';

export const metadata = pageMetadata({
  path: '/monitor',
  title: 'Serial monitor',
  description: DESCRIPTION,
  image: '/og/og-monitor.png',
  imageAlt: 'Watch boot logs and check a Keyzforge flash over Web Serial',
});

const JSON_LD = webPageJsonLd({
  path: '/monitor',
  name: 'Serial monitor | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-08-31',
  dateModified: '2026-10-05',
  crumb: 'Serial monitor',
  extra: siteJsonLd(),
});

export default function MonitorPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <JsonLd data={JSON_LD} />
      <PageIntro
        title="Serial monitor"
        text="Read boot messages, reset the board, and see the moment it starts running as a security key."
      />
      <SerialMonitor />
    </div>
  );
}
