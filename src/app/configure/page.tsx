import type { Metadata } from 'next';
import { Configurator } from '@/components/configurator';
import { PageIntro } from '@/components/log';

export const metadata: Metadata = {
  title: 'Configure a key',
  description: 'Set the LED pin, colour order, brightness, USB identity and interfaces of a pico-fido key over WebUSB.',
};

export default function ConfigurePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageIntro
        title="Configure a key"
        text="Change the LED, USB identity and security settings of a running pico-fido key. Every write is reviewed first and confirmed with the BOOT button."
      />
      <Configurator />
    </div>
  );
}
