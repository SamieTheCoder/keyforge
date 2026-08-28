'use client';

import { CheckCircle, CircleNotch, HandTap, Plug, Warning, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export type WriteStage = 'idle' | 'writing' | 'saved' | 'unplugged' | 'applied' | 'failed';

const STEPS: { id: Exclude<WriteStage, 'idle' | 'failed'>; label: string }[] = [
  { id: 'writing', label: 'Press BOOT' },
  { id: 'saved', label: 'Saved' },
  { id: 'unplugged', label: 'Replug' },
  { id: 'applied', label: 'Applied' },
];

const COPY: Record<Exclude<WriteStage, 'idle'>, { title: string; text: string }> = {
  writing: {
    title: 'Waiting for the BOOT button',
    text: 'When the LED blinks yellow, press BOOT on the board once to confirm the write.',
  },
  saved: {
    title: 'Configuration saved',
    text: 'The key stored the new settings. Unplug it now, then plug it back in to apply them.',
  },
  unplugged: {
    title: 'Key unplugged',
    text: 'Plug it back in. Keyforge will confirm when it returns with the new settings.',
  },
  applied: {
    title: 'Done. New settings are active',
    text: 'The key restarted with your configuration. Click Connect key to check or change it again.',
  },
  failed: {
    title: 'Nothing was changed',
    text: 'The write did not finish. Check the Activity log, then try again.',
  },
};

export function WriteStatus({ stage, onDismiss }: { stage: WriteStage; onDismiss: () => void }) {
  if (stage === 'idle') return null;
  const { title, text } = COPY[stage];
  const reached = STEPS.findIndex((s) => s.id === stage);
  const tone = stage === 'failed' ? 'danger' : stage === 'applied' || stage === 'saved' ? 'ok' : 'warn';
  const Icon =
    stage === 'writing' ? HandTap : stage === 'unplugged' ? Plug : stage === 'failed' ? Warning : CheckCircle;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        'panel relative overflow-hidden p-5',
        tone === 'ok' && 'border-[color-mix(in_srgb,var(--ok)_50%,transparent)]',
        tone === 'warn' && 'border-[color-mix(in_srgb,var(--warn)_50%,transparent)]',
        tone === 'danger' && 'border-[color-mix(in_srgb,var(--danger)_50%,transparent)]'
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full',
            tone === 'ok' && 'bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-ok',
            tone === 'warn' && 'bg-warn-soft text-warn',
            tone === 'danger' && 'bg-danger-soft text-danger'
          )}
        >
          <Icon size={24} weight="duotone" className={cn(stage === 'writing' && 'motion-safe:animate-pulse')} />
        </span>
        <div className="flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted">{text}</p>
        </div>
        {(stage === 'applied' || stage === 'failed') && (
          <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss">
            <X size={14} weight="bold" />
          </Button>
        )}
      </div>

      {stage !== 'failed' && (
        <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Write progress">
          {STEPS.map((s, i) => {
            const done = i < reached || stage === 'applied';
            const now = i === reached && stage !== 'applied';
            return (
              <li key={s.id} className="flex flex-col gap-2">
                <span
                  className={cn(
                    'h-1.5 rounded-full',
                    done ? 'bg-ok' : now ? 'bg-warn motion-safe:animate-pulse' : 'bg-line'
                  )}
                />
                <span className={cn('flex items-center gap-1 text-xs', done ? 'text-ok' : now ? 'text-fg' : 'text-faint')}>
                  {now && stage === 'writing' && <CircleNotch size={12} className="motion-safe:animate-spin" />}
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
