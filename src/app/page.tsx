import {
  ArrowRight,
  Cpu,
  DownloadSimple,
  GitBranch,
  Key,
  Lightning,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
} from '@phosphor-icons/react/dist/ssr';
import { Branches, Exploded, Lockers, Patch } from '@lucasmarkes/hairline/react';
import Link from 'next/link';
import { KeyMark } from '@/components/logo';
import { buttonClass } from '@/components/ui';
import { SITE } from '@/lib/site';
import { cn } from '@/lib/utils';

const BOARDS = [
  { chip: 'ESP32-S3', note: 'Waveshare S3-Zero, DevKitC-1 and more', how: 'Flash over USB from the browser' },
  { chip: 'ESP32-S2', note: 'S2 Mini, Saola and similar boards', how: 'Flash over USB from the browser' },
  { chip: 'RP2350', note: 'Raspberry Pi Pico 2 and RP2350 boards', how: 'Flash over USB from the browser' },
  { chip: 'RP2040', note: 'Raspberry Pi Pico and 40+ RP2040 boards', how: 'Flash over USB from the browser' },
];

export default function Home() {
  return (
    <>
      {/* Hero: split, copy left, mark right */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 md:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="rise inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <ShieldCheck size={14} weight="bold" /> Open source, runs in your browser
          </p>
          <h1 className="rise mt-6 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl" style={{ ['--i' as string]: 1 }}>
            Forge your own <span className="text-mesh">security key.</span>
          </h1>
          <p className="rise mt-5 max-w-[52ch] text-lg leading-relaxed text-muted" style={{ ['--i' as string]: 2 }}>
            Flash pico-fido onto an ESP32 or Raspberry Pi board, then tune its LED, USB identity and security from one place.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ ['--i' as string]: 3 }}>
            <Link href="/flash" className={buttonClass('primary', 'lg')}>
              Start flashing <ArrowRight size={18} weight="bold" />
            </Link>
            <Link href="/configure" className={buttonClass('secondary', 'lg')}>
              Configure a key
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md" aria-hidden>
          <div className="absolute inset-6 rounded-[40px] bg-[radial-gradient(circle_at_70%_20%,rgb(20_255_236/35%),transparent_60%),radial-gradient(circle_at_20%_90%,rgb(0_201_199/28%),transparent_60%)] blur-2xl" />
          <div className="panel relative grid aspect-square place-items-center overflow-hidden rounded-[32px]">
            <div className="bg-grid absolute inset-0 opacity-80 [mask-image:none]" />
            <KeyMark className="relative h-[62%] w-auto drop-shadow-[0_20px_40px_rgb(0_201_199/35%)]" />
            <div className="absolute inset-x-6 bottom-6 flex items-center justify-between rounded-[14px] border border-line bg-sunken/80 px-4 py-3 font-mono text-xs text-muted backdrop-blur">
              <span>pico-fido 8.0</span>
              <span className="text-ok">FIDO2 ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tools bento: F F C / F F P / M O O */}
      <section aria-labelledby="tools" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <h2 id="tools" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Everything a key needs, start to finish.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Tool
            href="/flash"
            icon={<DownloadSimple size={22} weight="duotone" />}
            title="Flasher"
            text="ESP32 over Web Serial, Raspberry Pi Pico over WebUSB. Firmware comes from Keyforge or official releases, and is checked against your chip before it is written."
            className="md:col-span-2 md:row-span-2"
            figure={<Exploded className="figure w-full max-w-[540px]" label="A firmware image taken apart into layers" />}
            big
          />
          <Tool
            href="/configure"
            icon={<SlidersHorizontal size={22} weight="duotone" />}
            title="Configurator"
            text="LED pin, colours, brightness, USB name and secure boot. No PIN or admin rights."
            figure={<Patch className="figure w-full max-w-[220px]" label="A patch panel of board settings" />}
          />
          <Tool
            href="/passkeys"
            icon={<Key size={22} weight="duotone" />}
            title="Passkeys"
            text="Set your PIN, see which sites have a passkey on the key, and remove the ones you no longer use."
            figure={<Lockers className="figure w-full max-w-[220px]" label="Lockers, one per passkey" />}
          />
          <Tool
            href="/monitor"
            icon={<Terminal size={22} weight="duotone" />}
            title="Monitor"
            text="Watch boot logs and see the moment your board starts running as a key."
          />
          <Tool
            href="/how-it-works#firmware"
            icon={<GitBranch size={22} weight="duotone" />}
            title="Open firmware"
            text="The firmware is built in public by GitHub Actions from pico-fido source. Fork it, change a build option, and flash your own."
            className="md:col-span-2"
            figure={<Branches className="figure w-full max-w-[240px]" label="A commit graph forking from upstream" />}
            row
          />
        </div>
      </section>

      {/* Hardware: 4 items in a 2x2 */}
      <section aria-labelledby="hardware" className="border-y border-line bg-sunken/60">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 id="hardware" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Works with boards you can buy for a few dollars.
          </h2>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-2">
            {BOARDS.map((b) => (
              <li key={b.chip} className="flex items-start gap-4 bg-bg p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent">
                  <Cpu size={20} weight="duotone" />
                </span>
                <div>
                  <p className="font-mono text-[15px] font-semibold">{b.chip}</p>
                  <p className="mt-0.5 text-sm text-muted">{b.note}</p>
                  <p className="mt-2 text-xs text-faint">{b.how}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Flow: vertical stack */}
      <section aria-labelledby="flow" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h2 id="flow" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          From bare board to passkey in minutes.
        </h2>
        <ol className="mt-10 space-y-3">
          {[
            ['Flash', 'Plug the board in while holding BOOT and let Keyforge write pico-fido.'],
            ['Configure', 'Point the LED at the right pin and pick a colour order that looks right.'],
            ['Register', 'Add the key to your accounts as a passkey or second factor.'],
          ].map(([t, d], i) => (
            <li key={t} className="panel flex gap-4 p-5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-sm text-accent">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold">{t}</p>
                <p className="mt-1 text-sm text-muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex justify-center gap-3">
          <Link href="/flash" className={buttonClass('primary', 'lg')}>
            <Lightning size={18} weight="fill" /> Start flashing
          </Link>
          <a href={SITE.repoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'lg')}>
            View source
          </a>
        </div>
      </section>
    </>
  );
}

function Tool({
  href,
  icon,
  title,
  text,
  className,
  big,
  row,
  figure,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  className?: string;
  big?: boolean;
  row?: boolean;
  figure?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'panel group relative flex flex-col overflow-hidden p-6 transition-[border-color,transform] duration-300 ease-out-expo hover:-translate-y-0.5 hover:border-accent-line',
        big && 'p-8',
        row && 'md:flex-row md:items-center md:gap-8',
        className
      )}
    >
      {figure && (
        <div
          className={cn(
            'flex justify-center',
            big ? 'mb-6 flex-1 items-center' : 'mb-4',
            row && 'md:order-2 md:mb-0 md:w-[260px] md:shrink-0'
          )}
        >
          {figure}
        </div>
      )}
      <div className={cn(row && 'md:flex-1')}>
        <span className="grid size-11 place-items-center rounded-[12px] border border-accent-line bg-accent-soft text-accent">
          {icon}
        </span>
        <p className={cn('mt-5 font-semibold tracking-tight', big ? 'text-2xl' : 'text-lg')}>{title}</p>
        <p className={cn('mt-2 leading-relaxed text-muted', big ? 'max-w-[52ch]' : 'text-sm')}>{text}</p>
        <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
          Open <ArrowRight size={15} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
