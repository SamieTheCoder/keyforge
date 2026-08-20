'use client';

import { CheckCircle, CircleDashed, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Panel } from '@/components/ui';
import {
  boardVerdict,
  classifySerial,
  classifyUsb,
  dedupeBoards,
  describeTransition,
  ESPRESSIF_VID,
  RPI_VID,
  type BoardItem,
} from '@/lib/boards';
import { cn } from '@/lib/utils';
import { findWebCcidInterface } from '@/lib/webusb';
import type { LogKind } from './log';

/** Watches permitted USB and serial devices and classifies them. */
export function useBoards(log?: (kind: LogKind, text: string) => void) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const prev = useRef<BoardItem[]>([]);
  const logRef = useRef(log);
  useEffect(() => {
    logRef.current = log;
  }, [log]);

  const scan = useCallback(async () => {
    const usb = 'usb' in navigator ? await navigator.usb.getDevices().catch(() => []) : [];
    const ports = 'serial' in navigator ? await navigator.serial.getPorts().catch(() => []) : [];
    const next = dedupeBoards([
      ...usb.map((d) =>
        classifyUsb({
          vendorId: d.vendorId,
          productId: d.productId,
          productName: d.productName ?? undefined,
          hasWebCcid: !!findWebCcidInterface(d),
        })
      ),
      ...ports.map((p) => classifySerial(p.getInfo())),
    ]);
    const change = describeTransition(prev.current, next);
    if (change) logRef.current?.(change.level === 'ok' ? 'ok' : change.level === 'warn' ? 'wait' : 'info', change.text);
    prev.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void scan(), 400);
    };
    queue();
    const usb = 'usb' in navigator ? navigator.usb : null;
    const serial = 'serial' in navigator ? navigator.serial : null;
    usb?.addEventListener('connect', queue);
    usb?.addEventListener('disconnect', queue);
    serial?.addEventListener('connect', queue);
    serial?.addEventListener('disconnect', queue);
    return () => {
      clearTimeout(timer);
      usb?.removeEventListener('connect', queue);
      usb?.removeEventListener('disconnect', queue);
      serial?.removeEventListener('connect', queue);
      serial?.removeEventListener('disconnect', queue);
    };
  }, [scan]);

  /** Ask the browser for access to a board so it can be watched. */
  const find = useCallback(async () => {
    if (!('usb' in navigator)) return;
    try {
      await navigator.usb.requestDevice({
        filters: [{ vendorId: ESPRESSIF_VID }, { vendorId: RPI_VID }, { classCode: 0xff }],
      });
    } catch (e) {
      if ((e as Error).name !== 'NotFoundError') logRef.current?.('error', (e as Error).message);
    }
    await scan();
  }, [scan]);

  return { items, verdict: boardVerdict(items), scan, find };
}

export function BoardStatusPanel({ boards }: { boards: ReturnType<typeof useBoards> }) {
  const { items, verdict, find } = boards;
  const Icon = verdict.level === 'ok' ? CheckCircle : verdict.level === 'warn' ? Warning : CircleDashed;
  return (
    <Panel
      title="Board status"
      actions={
        <Button size="sm" onClick={find}>
          Find board
        </Button>
      }
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex gap-3 rounded-[10px] border px-4 py-3',
          verdict.level === 'ok' && 'border-[color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--ok)_8%,transparent)]',
          verdict.level === 'warn' && 'border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-warn-soft',
          verdict.level === 'idle' && 'border-line bg-sunken'
        )}
      >
        <Icon
          size={20}
          weight="duotone"
          className={cn('mt-0.5 shrink-0', verdict.level === 'ok' ? 'text-ok' : verdict.level === 'warn' ? 'text-warn' : 'text-muted')}
        />
        <div>
          <p className="text-sm font-semibold">{verdict.title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{verdict.text}</p>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.map((it) => (
            <li
              key={it.key}
              className={cn(
                'flex items-center justify-between gap-3 rounded-[10px] border border-line bg-raised px-3 py-2 text-[13px]',
                it.kind === 'pico-key' && 'border-l-[3px] border-l-ok',
                (it.kind === 'esp-bootloader' || it.kind === 'rp-bootsel') && 'border-l-[3px] border-l-warn'
              )}
            >
              <span className="font-medium">{it.label}</span>
              <span className="font-mono text-xs text-muted">
                {it.usbId} via {it.via}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
