import type { Metadata } from 'next';
import { Flasher } from '@/components/flasher';
import { PageIntro } from '@/components/log';

export const metadata: Metadata = {
  title: 'Flash firmware',
  description: 'Flash pico-fido onto ESP32-S3, ESP32-S2, RP2040 and RP2350 boards from the browser.',
};

export default function FlashPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageIntro
        title="Flash firmware"
        text="Pick your chip, choose a pico-fido release, and write it. Files are checked against the chip before anything is written."
      />
      <Flasher />
    </div>
  );
}
