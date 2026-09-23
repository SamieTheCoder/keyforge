import { JsonLd } from '@/components/json-ld';
import { pageMetadata, siteJsonLd, webPageJsonLd } from '@/lib/page-seo';
import { SITE } from '@/lib/site';

const DESCRIPTION =
  'Keyzforge has no accounts, no analytics, no cookies and no tracking. What stays on your device and what the network sees.';

export const metadata = pageMetadata({
  path: '/privacy',
  title: 'Privacy',
  description: DESCRIPTION,
  robots: { index: false, follow: false },
});

const UPDATED = '3 October 2026';

const JSON_LD = webPageJsonLd({
  path: '/privacy',
  name: 'Privacy | Keyzforge',
  description: DESCRIPTION,
  datePublished: '2026-09-19',
  dateModified: '2026-10-03',
  crumb: 'Privacy',
  extra: siteJsonLd(),
});

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <JsonLd data={JSON_LD} />
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
        Privacy
      </h1>
      <p className="text-muted mt-3 text-sm">Last updated {UPDATED}</p>

      <div className="text-muted [&_h2]:text-fg [&_strong]:text-fg mt-10 space-y-10 text-[15px] leading-relaxed [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold">
        <section>
          <h2>The short version</h2>
          <p>
            Keyzforge has no accounts, no analytics, no cookies and no tracking.
            Everything you do with your security key happens in your browser and
            goes straight to the USB device. We never see your key, its
            settings, its serial number or your passkeys.
          </p>
        </section>

        <section>
          <h2>What stays on your device</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>USB and serial communication.</strong> Flashing,
              configuration and the serial monitor use WebUSB and Web Serial.
              The data moves between the browser tab and your board only.
            </li>
            <li>
              <strong>Device permissions.</strong> When you allow a device, your
              browser remembers that choice. You can revoke it in your
              browser&apos;s site settings.
            </li>
            <li>
              <strong>Theme preference.</strong> Your light or dark choice is
              saved in local storage under the key <code>kf-theme</code>.
            </li>
            <li>
              <strong>Saved files.</strong> Logs you export are created in the
              browser and saved where you choose.
            </li>
          </ul>
        </section>

        <section>
          <h2>Network requests</h2>
          <p>
            Keyzforge only contacts two places, and only when you open the Flash
            page or download firmware:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>GitHub&apos;s API</strong> (api.github.com), to list
              firmware releases. GitHub receives your IP address and browser
              details as with any website, under{' '}
              <a
                className="text-accent underline underline-offset-2"
                href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub&apos;s privacy statement
              </a>
              .
            </li>
            <li>
              <strong>Our firmware route</strong> (/api/firmware), which fetches
              the release file you picked from GitHub and passes it to your
              browser. It is limited to public firmware repositories and does
              not store or log what you download.
            </li>
          </ul>
          <p className="mt-3">
            Fonts and all other assets are served from this site. No third-party
            scripts are loaded.
          </p>
        </section>

        <section>
          <h2>Server logs</h2>
          <p>
            Like any web server, our hosting provider may keep short-lived
            access logs (IP address, time, requested path) to keep the service
            running and to stop abuse. We do not use them to identify or profile
            anyone.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            Keyzforge is a developer tool and is not directed at children. It
            does not knowingly collect any personal data from anyone.
          </p>
        </section>

        <section>
          <h2>Changes and contact</h2>
          <p>
            If this policy changes, the date at the top changes too, and the
            history is visible in the{' '}
            <a
              className="text-accent underline underline-offset-2"
              href={SITE.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              public repository
            </a>
            . Questions:{' '}
            <a
              className="text-accent underline underline-offset-2"
              href={`mailto:${SITE.contactEmail}`}
            >
              {SITE.contactEmail}
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
