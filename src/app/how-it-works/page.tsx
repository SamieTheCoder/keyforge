import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import {
  Branches,
  Exploded,
  Lockers,
  Padlock,
  Patch,
  Terminal,
  Vault,
} from '@lucasmarkes/hairline/react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { SITE } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How Keyzforge flashes, configures and manages Keyzforge security keys from the browser, and how the firmware is built.',
};

type Step = {
  id: string;
  kicker: string;
  title: string;
  body: React.ReactNode;
  facts: [string, string][];
  figure: React.ReactNode;
};

const fig = 'figure w-full max-w-[420px]';

const STEPS: Step[] = [
  {
    id: 'firmware',
    kicker: 'Firmware',
    title: 'Built in the open, from source you can fork.',
    body: (
      <>
        Keyzforge firmware lives in <code>firmware/</code>: a pinned open-source
        FIDO2 code base plus Keyzforge patches, all AGPL-3.0. GitHub Actions
        builds every board in a public Docker image and publishes each release
        with checksums and the complete source. Change a build option, add a
        patch, and run the same script to get your own key.
      </>
    ),
    facts: [
      ['Source', 'firmware/ (pinned source + patches)'],
      ['Build', 'firmware/build.sh in firmware/Dockerfile'],
      ['Release', 'fw-<version>: .bin, .uf2, SHA256SUMS, source'],
    ],
    figure: (
      <Branches
        className={fig}
        label="A commit graph: firmware forked from upstream and merged back"
      />
    ),
  },
  {
    id: 'flash',
    kicker: 'Flash',
    title: 'The image is checked before a single byte is written.',
    body: (
      <>
        ESP32 boards are flashed over Web Serial with Espressif&apos;s
        esptool-js, and the write is verified by MD5. RP2040 and RP2350 boards
        are flashed over WebUSB through the bootrom&apos;s PICOBOOT interface:
        every 4 KiB sector is erased, written and read back. Before that,
        Keyzforge reads the file and refuses images built for another chip or,
        on a secure-boot RP2350, unsigned ones.
      </>
    ),
    facts: [
      ['ESP32-S3, ESP32-S2', 'Web Serial, esptool-js, MD5 verify'],
      ['RP2040, RP2350', 'WebUSB PICOBOOT, byte-for-byte verify'],
      ['Passkeys', 'Kept: only the sectors in the file change'],
    ],
    figure: (
      <Exploded
        className={fig}
        label="An application taken apart into layers, like a firmware image"
      />
    ),
  },
  {
    id: 'configure',
    kicker: 'Configure',
    title: 'Board settings without a PIN or a driver.',
    body: (
      <>
        The firmware has a small rescue applet behind its USB smart-card
        interface. Keyzforge talks to it over WebUSB to read and write the board
        record: LED pin, driver, colour order and brightness, USB name and IDs,
        and which interfaces are on. Writes are committed only after you press
        the board&apos;s BOOT button, and the page tells you when the key has
        restarted with them.
      </>
    ),
    facts: [
      ['Transport', 'WebUSB, CCID, rescue applet'],
      ['Settings', 'LED, USB identity, interfaces, timeouts'],
      ['Confirm', 'BOOT button press on the key'],
    ],
    figure: (
      <Patch
        className={fig}
        label="A patch panel with cables, like board pins and settings"
      />
    ),
  },
  {
    id: 'passkeys',
    kicker: 'Passkeys',
    title: 'See and remove the passkeys stored on your key.',
    body: (
      <>
        Browsers do not let web pages use a key&apos;s FIDO channel directly, so
        Keyzforge sends the same CTAP2 commands through the FIDO applet on the
        smart-card interface. Your PIN is hashed and encrypted in this tab with
        WebCrypto before it reaches the key, and the list of sites and accounts
        exists only on the page.
      </>
    ),
    facts: [
      ['Protocol', 'CTAP 2.1 credential management, PIN protocol 1'],
      ['Capacity', 'Up to 256 passkeys per key'],
      ['Leaves the tab', 'Nothing'],
    ],
    figure: (
      <Lockers
        className={fig}
        label="A bank of lockers, one per stored passkey"
      />
    ),
  },
  {
    id: 'secure-boot',
    kicker: 'Secure boot',
    title: 'Optional, permanent, and explained before you commit.',
    body: (
      <>
        On ESP32-S3, ESP32-S2 and RP2350, the firmware can burn the upstream
        release-key digest into eFuse or OTP. After that the chip only boots
        firmware signed with that key. Keyzforge shows the current state, asks
        you to type a confirmation, and warns when the firmware you flashed
        would not boot under it. It never burns anything on its own.
      </>
    ),
    facts: [
      ['Chips', 'ESP32-S3/S2 eFuse, RP2350 OTP'],
      ['Boots afterwards', 'The upstream signed build only'],
      ['Undo', 'Not possible, by design'],
    ],
    figure: (
      <Padlock
        className={fig}
        label="A padlock whose shackle opens as you come near"
      />
    ),
  },
  {
    id: 'monitor',
    kicker: 'Monitor',
    title: 'Read the boot log when something looks wrong.',
    body: (
      <>
        The monitor opens the board&apos;s serial port and turns common boot
        messages into plain advice: wrong flash mode, a rejected image, a board
        stuck in the bootloader. It also shows how to reset each board into the
        mode you need.
      </>
    ),
    facts: [
      ['Transport', 'Web Serial'],
      ['Hints', 'Bootloader, flash, secure boot, USB'],
    ],
    figure: (
      <Terminal
        className={fig}
        label="A terminal window with its history in rows"
      />
    ),
  },
  {
    id: 'privacy',
    kicker: 'Privacy',
    title: 'Your key talks to your browser, not to us.',
    body: (
      <>
        There are no accounts, analytics or cookies. The only network requests
        are the public GitHub release list and firmware downloads, which go
        through a same-origin route limited to a fixed list of repositories and
        file types. Everything else is between this tab and the USB device.
      </>
    ),
    facts: [
      ['Network', 'GitHub releases, /api/firmware'],
      ['Stored', 'Your theme choice, nothing else'],
    ],
    figure: (
      <Vault className={fig} label="A vault door with a dial and bolts" />
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-4 pt-14 pb-10 text-center sm:px-6 md:pt-20">
        <p className="text-accent text-sm font-medium">How it works</p>
        <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl">
          Firmware and software,{' '}
          <span className="text-mesh">all in the open.</span>
        </h1>
        <p className="text-muted mx-auto mt-5 max-w-[56ch] text-lg leading-relaxed">
          Keyzforge is a web app that talks to your security key over WebUSB and
          Web Serial, and a firmware pipeline that builds the key firmware from
          source. Move your pointer over the drawings.
        </p>
        <nav
          aria-label="Sections"
          className="mt-8 flex flex-wrap justify-center gap-2"
        >
          {STEPS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="border-line text-muted hover:border-line-strong hover:text-fg rounded-full border px-3 py-1 text-[13px] transition-colors"
            >
              {s.kicker}
            </a>
          ))}
        </nav>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-20 sm:px-6">
        {STEPS.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            aria-labelledby={`${s.id}-title`}
            className="panel grid scroll-mt-24 items-center gap-8 overflow-hidden p-6 sm:p-10 md:grid-cols-2"
          >
            <div
              className={cn('flex justify-center', i % 2 === 1 && 'md:order-2')}
            >
              {s.figure}
            </div>
            <div>
              <p className="text-accent font-mono text-xs tracking-wide uppercase">
                {String(i + 1).padStart(2, '0')} {s.kicker}
              </p>
              <h2
                id={`${s.id}-title`}
                className="mt-2 text-2xl font-semibold tracking-tight"
              >
                {s.title}
              </h2>
              <p className="text-muted [&_code]:text-fg mt-3 leading-relaxed [&_code]:font-mono [&_code]:text-[0.9em]">
                {s.body}
              </p>
              <dl className="divide-line border-line mt-5 divide-y rounded-[12px] border text-sm">
                {s.facts.map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 px-4 py-2.5"
                  >
                    <dt className="text-faint">{k}</dt>
                    <dd className="font-mono text-[13px] break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ))}

        <div className="flex flex-wrap justify-center gap-3 pt-6">
          <Link href="/flash" className={buttonClass('primary', 'lg')}>
            Start flashing <ArrowRight size={18} weight="bold" />
          </Link>
          <a
            href={`${SITE.repoUrl}/tree/main/firmware`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('ghost', 'lg')}
          >
            Build your own firmware
          </a>
        </div>
      </div>
    </>
  );
}
