import { JsonLd } from '@/components/json-ld';
import { PageIntro } from '@/components/log';
import { Passkeys } from '@/components/passkeys';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';

const DESCRIPTION =
  'Set or change the FIDO2 PIN of a Keyzforge key and manage the passkeys stored on it, all from your browser. No accounts, no tracking.';

export const metadata = pageMetadata({
  path: '/passkeys',
  title: 'Passkeys and PIN',
  description: DESCRIPTION,
  image: '/og/og-passkeys.png',
  imageAlt: 'Manage the PIN and passkeys stored on a Keyzforge key',
});

const JSON_LD = webPageJsonLd({
  path: '/passkeys',
  name: 'Passkeys and PIN | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-09-04',
  dateModified: '2026-10-05',
  crumb: 'Passkeys and PIN',
  extra: siteJsonLd(),
});

export default function PasskeysPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <JsonLd data={JSON_LD} />
      <PageIntro
        title="Passkeys and PIN"
        text="Set or change your key's PIN, check how much passkey storage is left, and remove passkeys you no longer use."
      />
      <Passkeys />
    </div>
  );
}
