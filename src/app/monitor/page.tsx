import type { Metadata } from 'next';
import { PageIntro } from '@/components/log';
import { SerialMonitor } from '@/components/serial-monitor';

export const metadata: Metadata = {
  title: 'Serial monitor',
  description: 'Watch ESP32 boot logs and check whether your pico-fido flash worked.',
};

export default function MonitorPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageIntro
        title="Serial monitor"
        text="Read boot messages, reset the board, and see the moment it starts running as a security key."
      />
      <SerialMonitor />
    </div>
  );
}
