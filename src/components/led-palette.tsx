'use client';

import { useState } from 'react';
import {
  LED_PALETTES,
  LED_STATES,
  ledColour,
  MAX_BRIGHTNESS,
  orderFor,
  PRIMARIES,
  primariesOf,
  type Primary,
} from '@/lib/protocol';
import { cn } from '@/lib/utils';

/**
 * LED colour picker. pico-fido fixes the colour of each state in firmware and
 * only lets the RGB channel order change, so every option here maps to one of
 * the six channel orders. "Custom" asks for the two colours people care about
 * (Ready and No computer) and derives the order from them.
 */
export function LedPalette({
  value,
  brightness,
  disabled,
  onChange,
}: {
  value: number | null;
  brightness: number | null;
  disabled?: boolean;
  onChange: (order: number) => void;
}) {
  const order = value ?? 0;
  const b = brightness ?? MAX_BRIGHTNESS;
  const [mode, setMode] = useState<'presets' | 'custom'>('presets');
  const { ready, noHost } = primariesOf(order);

  const pickCustom = (r: Primary, n: Primary) => {
    // If both would be the same, move "No computer" to the next free colour.
    const next = r === n ? PRIMARIES.find((p) => p.id !== r)!.id : n;
    const o = orderFor(r, next);
    if (o != null) onChange(o);
  };

  return (
    <fieldset disabled={disabled} className={cn('min-w-0', disabled && 'opacity-50')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <legend className="text-[13px] font-medium">LED colours</legend>
        <div role="tablist" aria-label="Colour mode" className="inline-flex rounded-full border border-line p-0.5 text-xs">
          {(['presets', 'custom'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-full px-3 py-1 capitalize transition-colors',
                mode === m ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === 'presets' ? (
        <div role="radiogroup" aria-label="Colour presets" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LED_PALETTES.map((p) => {
            const active = order === p.order;
            return (
              <button
                key={p.order}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(p.order)}
                className={cn(
                  'flex items-center gap-2.5 rounded-full border py-1.5 pr-3 pl-2.5 text-[13px] transition-colors',
                  active ? 'border-accent-line bg-accent-soft text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg'
                )}
              >
                <span className="flex -space-x-1" aria-hidden>
                  {LED_STATES.slice(0, 3).map((s) => (
                    <span key={s.id} className="size-3 rounded-full ring-2 ring-[var(--panel-solid)]" style={{ background: ledColour(p.order, s.rgb) }} />
                  ))}
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColourChoice label="Ready" value={ready} onChange={(c) => pickCustom(c, noHost === c ? ready : noHost)} />
          <ColourChoice label="No computer" value={noHost} exclude={ready} onChange={(c) => pickCustom(ready, c)} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2 rounded-[12px] bg-[#0c0e0e] px-3 py-3" aria-label="Preview">
        {LED_STATES.map((s) => {
          const c = ledColour(order, s.rgb, b);
          return (
            <div key={s.id} className="flex flex-col items-center gap-2 text-center">
              <span className="size-4 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} aria-hidden />
              <span className="text-[11px] leading-tight text-[#9aa7a5]">{s.label}</span>
            </div>
          );
        })}
      </div>
      {mode === 'custom' && (
        <p className="mt-2 text-[12px] text-muted">Press BOOT and Asleep follow from these two choices. That is all pico-fido can change.</p>
      )}
    </fieldset>
  );
}

function ColourChoice({
  label,
  value,
  exclude,
  onChange,
}: {
  label: string;
  value: Primary;
  exclude?: Primary;
  onChange: (c: Primary) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-muted">{label}</p>
      <div role="radiogroup" aria-label={`${label} colour`} className="flex gap-2">
        {PRIMARIES.map((p) => {
          const active = value === p.id;
          const off = exclude === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={p.label}
              title={off ? `${p.label} is used for Ready` : p.label}
              disabled={off}
              onClick={() => onChange(p.id)}
              className={cn(
                'grid size-9 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-25',
                active ? 'border-accent' : 'border-line hover:border-line-strong'
              )}
            >
              <span className="size-5 rounded-full" style={{ background: `rgb(${p.rgb.join(' ')})` }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
