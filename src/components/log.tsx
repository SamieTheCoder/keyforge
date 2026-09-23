'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export type LogKind = 'info' | 'ok' | 'wait' | 'error' | 'tx' | 'rx';
export interface LogLine {
  id: number;
  at: string;
  kind: LogKind;
  text: string;
}

const MAX = 600;
let seq = 0;

/** Small append-only log store for a page. */
export function useLog() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const log = useCallback((kind: LogKind, text: string) => {
    const at = new Date().toLocaleTimeString(undefined, { hour12: false });
    setLines((prev) => {
      const next = [...prev, { id: ++seq, at, kind, text }];
      return next.length > MAX ? next.slice(next.length - MAX) : next;
    });
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, log, clear };
}

const COLOR: Record<LogKind, string> = {
  info: 'text-[#d4e3e0]',
  ok: 'text-[#3ee0a3]',
  wait: 'text-[#f2c25b]',
  error: 'text-[#ff8e85]',
  tx: 'text-[#8fb3ff]',
  rx: 'text-[#7fd8b0]',
};

export function LogView({
  lines,
  onClear,
  showApdu = true,
  className,
  emptyText = 'Nothing yet.',
  height = 'h-64',
}: {
  lines: LogLine[];
  onClear?: () => void;
  showApdu?: boolean;
  className?: string;
  emptyText?: string;
  height?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const [copied, setCopied] = useState(false);
  const visible = showApdu
    ? lines
    : lines.filter((l) => l.kind !== 'tx' && l.kind !== 'rx');

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        visible.map((l) => `${l.at} ${l.text}`).join('\n')
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className={cn('relative', className)}>
      <ol
        ref={ref}
        role="log"
        aria-live="polite"
        tabIndex={0}
        className={cn(
          'term overflow-auto rounded-[10px] border border-[#1e2626] p-3',
          height
        )}
      >
        {visible.length === 0 && (
          <li className="text-[#6b7776]">{emptyText}</li>
        )}
        {visible.map((l) => (
          <li
            key={l.id}
            className={cn('break-all whitespace-pre-wrap', COLOR[l.kind])}
          >
            <span className="text-[#5d6a68]">{l.at} </span>
            {l.text}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          disabled={!visible.length}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!lines.length}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="bg-sunken h-2 overflow-hidden rounded-full"
      >
        <div
          className="from-accent-3 via-accent-2 to-accent h-full rounded-full bg-gradient-to-r transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PageIntro({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
        {title}
      </h1>
      <p className="text-muted mt-3 text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}
