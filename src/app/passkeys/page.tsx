import type { Metadata } from 'next';
import { PageIntro } from '@/components/log';
import { Passkeys } from '@/components/passkeys';

export const metadata: Metadata = {
  title: 'Passkeys and PIN',
  description: 'Set or change the FIDO PIN of a pico-fido key and manage the passkeys stored on it.',
};

export default function PasskeysPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageIntro
        title="Passkeys and PIN"
        text="Set or change your key's PIN, check how much passkey storage is left, and remove passkeys you no longer use."
      />
      <Passkeys />
    </div>
  );
}
