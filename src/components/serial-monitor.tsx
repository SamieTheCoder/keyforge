'use client';

import {
  ArrowClockwise,
  DownloadSimple,
  PaperPlaneRight,
  Plug,
  PlugsConnected,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardStatusPanel, useBoards } from '@/components/board-status';
import { LogView, useLog } from '@/components/log';
import { Button, Check, Notice, Panel, Pill } from '@/components/ui';
import {
  bootHint,
  classifySerial,
  ESP_USB_JTAG_PID,
  ESPRESSIF_VID,
  LineBuffer,
  logLevel,
  resetSteps,
  stripAnsi,
  type Hint,
} from '@/lib/boards';
import { useBrowserCaps } from '@/lib/caps';
import { cn } from '@/lib/utils';

interface Line {
  id: number;
  at: string;
  text: string;
  cls: 'error' | 'warn' | 'info' | 'debug' | 'sys' | 'tx' | null;
}

const MAX_LINES = 3000;
const BAUDS = [9600, 57600, 115200, 230400, 460800, 921600];
const LINE_CLASS: Record<NonNullable<Line['cls']>, string> = {
  error: 'text-[#ff8e85]',
  warn: 'text-[#f2c25b]',
  info: 'text-[#7fd8b0]',
  debug: 'text-[#6b7776]',
  sys: 'text-[#8fb3ff]',
  tx: 'text-[#c8b6ff]',
};
let lineSeq = 0;

export function SerialMonitor() {
  const caps = useBrowserCaps();
  const activity = useLog();
  const boards = useBoards(activity.log);
  const [baud, setBaud] = useState(115200);
  const [open, setOpen] = useState(false);
  const [usbJtag, setUsbJtag] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [hint, setHint] = useState<Hint | null>(null);
  const [timestamps, setTimestamps] = useState(false);
  const [follow, setFollow] = useState(true);
  const [input, setInput] = useState('');
  const [eol, setEol] = useState('\n');

  const port = useRef<SerialPort | null>(null);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReading = useRef(false);
  const out = useRef<HTMLDivElement>(null);

  const append = useCallback((text: string, cls: Line['cls']) => {
    const at = new Date().toLocaleTimeString(undefined, { hour12: false });
    setLines((prev) => {
      const next = [...prev, { id: ++lineSeq, at, text, cls }];
      return next.length > MAX_LINES
        ? next.slice(next.length - MAX_LINES)
        : next;
    });
  }, []);

  const handleLine = useCallback(
    (raw: string) => {
      const line = stripAnsi(raw);
      append(line, logLevel(line));
      const h = bootHint(line);
      if (h) setHint(h);
    },
    [append]
  );

  useEffect(() => {
    if (follow && out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [lines, follow]);

  const cleanup = useCallback(
    async (reason: string) => {
      const p = port.current;
      if (!p) return;
      port.current = null;
      keepReading.current = false;
      try {
        await p.close();
      } catch {
        /* already gone */
      }
      setOpen(false);
      append(`[${reason}]`, 'sys');
    },
    [append]
  );

  const readLoop = useCallback(
    async (p: SerialPort) => {
      const decoder = new TextDecoder();
      const buf = new LineBuffer();
      let idle: ReturnType<typeof setTimeout> | undefined;
      while (p.readable && keepReading.current) {
        const r = p.readable.getReader();
        reader.current = r;
        try {
          for (;;) {
            const { value, done } = await r.read();
            if (done) break;
            for (const l of buf.push(decoder.decode(value, { stream: true })))
              handleLine(l);
            clearTimeout(idle);
            if (buf.pending)
              idle = setTimeout(
                () => buf.pending && handleLine(buf.flush()),
                250
              );
          }
        } catch (e) {
          const err = e as Error;
          if (err.name === 'NetworkError') break;
          if (keepReading.current)
            append(`[read error: ${err.message}]`, 'warn');
        } finally {
          r.releaseLock();
          reader.current = null;
        }
      }
      clearTimeout(idle);
      if (buf.pending) handleLine(buf.flush());
      await cleanup('port closed');
    },
    [append, cleanup, handleLine]
  );

  const connect = async () => {
    try {
      const p = await navigator.serial.requestPort();
      await p.open({ baudRate: baud, bufferSize: 8192 });
      const info = p.getInfo();
      const jtag =
        info.usbVendorId === ESPRESSIF_VID &&
        info.usbProductId === ESP_USB_JTAG_PID;
      port.current = p;
      keepReading.current = true;
      setUsbJtag(jtag);
      setOpen(true);
      setHint(null);
      const c = classifySerial(info);
      append(`[opened ${c.label} ${c.usbId} at ${baud} baud]`, 'sys');
      activity.log('info', `Serial port opened at ${baud} baud.`);
      void readLoop(p);
      void boards.scan();
    } catch (e) {
      const err = e as Error;
      if (err.name === 'NotFoundError') return;
      activity.log(
        'error',
        err.name === 'InvalidStateError' || /open/i.test(err.message)
          ? 'The port is in use. Close Arduino IDE, idf.py monitor, PuTTY or the Flash page, then try again.'
          : err.message
      );
    }
  };

  const disconnect = async () => {
    keepReading.current = false;
    await reader.current?.cancel().catch(() => {});
  };

  useEffect(() => {
    if (!caps.serial) return;
    const onDisconnect = (e: Event) => {
      if (port.current && e.target === port.current) {
        keepReading.current = false;
        void cleanup('device disconnected');
        if (usbJtag) {
          setHint({
            level: 'info',
            text: 'The bootloader port went away. If Board status now shows a security key, the firmware is running.',
          });
        }
      }
    };
    navigator.serial.addEventListener('disconnect', onDisconnect);
    return () =>
      navigator.serial.removeEventListener('disconnect', onDisconnect);
  }, [caps.serial, cleanup, usbJtag]);

  useEffect(
    () => () => {
      keepReading.current = false;
      void reader.current?.cancel().catch(() => {});
    },
    []
  );

  const reset = async (mode: 'run' | 'download') => {
    const p = port.current;
    if (!p) return;
    append(
      mode === 'run'
        ? '[resetting board to run firmware]'
        : '[resetting into download mode]',
      'sys'
    );
    try {
      for (const s of resetSteps(mode, { usbJtag })) {
        await p.setSignals({ dataTerminalReady: s.dtr, requestToSend: s.rts });
        if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      }
    } catch (e) {
      append(`[reset failed: ${(e as Error).message}]`, 'warn');
    }
  };

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const w = port.current?.writable?.getWriter();
    if (!w) return;
    try {
      await w.write(new TextEncoder().encode(input + eol));
      append(`> ${input}`, 'tx');
      setInput('');
    } catch (e) {
      append(`[write failed: ${(e as Error).message}]`, 'warn');
    } finally {
      w.releaseLock();
    }
  };

  const save = () => {
    const text = lines.map((l) => `${l.at} ${l.text}`).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `serial-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <Panel
        title="Serial monitor"
        actions={
          <Pill tone={open ? 'accent' : 'neutral'}>
            {open ? `Open at ${baud} baud` : 'Closed'}
          </Pill>
        }
      >
        {caps.ready && !caps.serial ? (
          <Notice tone="danger" title="Web Serial is not available">
            Use Chrome, Edge or another Chromium browser on desktop.
          </Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="baud" className="sr-only">
                Baud rate
              </label>
              <select
                id="baud"
                className="field-input w-32"
                value={baud}
                disabled={open}
                onChange={(e) => setBaud(Number(e.target.value))}
              >
                {BAUDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              {open ? (
                <Button onClick={disconnect}>
                  <Plug size={16} weight="bold" /> Close port
                </Button>
              ) : (
                <Button variant="primary" onClick={connect}>
                  <PlugsConnected size={16} weight="bold" /> Open port
                </Button>
              )}
              <Button
                onClick={() => reset('run')}
                disabled={!open}
                title="Pulse EN so the chip restarts and runs the firmware"
              >
                <ArrowClockwise size={16} weight="bold" /> Reset board
              </Button>
              <Button
                onClick={() => reset('download')}
                disabled={!open}
                title="Restart into the ROM download mode for flashing"
              >
                Download mode
              </Button>
            </div>

            <div className="relative mt-4">
              <div
                ref={out}
                role="log"
                aria-label="Serial output"
                tabIndex={0}
                className="term h-[460px] overflow-auto rounded-[10px] border border-[#1e2626] px-3 py-2"
              >
                {lines.map((l) => (
                  <div
                    key={l.id}
                    className={cn(
                      'break-all whitespace-pre-wrap',
                      l.cls && LINE_CLASS[l.cls]
                    )}
                  >
                    {timestamps && (
                      <span className="text-[#5d6a68]">{l.at} </span>
                    )}
                    {l.text}
                  </div>
                ))}
              </div>
              {lines.length === 0 && (
                <p className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-[#6b7776]">
                  Open the board&apos;s port to see boot messages here.
                </p>
              )}
            </div>

            {hint && (
              <Notice
                tone={
                  hint.level === 'error'
                    ? 'danger'
                    : hint.level === 'warn'
                      ? 'warn'
                      : 'neutral'
                }
                className="mt-3"
              >
                {hint.text}
              </Notice>
            )}

            <form
              onSubmit={send}
              className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2"
            >
              <label htmlFor="send" className="sr-only">
                Text to send
              </label>
              <input
                id="send"
                className="field-input font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="Send text"
                disabled={!open}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <label htmlFor="eol" className="sr-only">
                Line ending
              </label>
              <select
                id="eol"
                className="field-input w-24"
                value={eol}
                disabled={!open}
                onChange={(e) => setEol(e.target.value)}
              >
                <option value={'\n'}>LF</option>
                <option value={'\r\n'}>CRLF</option>
                <option value={'\r'}>CR</option>
                <option value="">None</option>
              </select>
              <Button type="submit" disabled={!open} aria-label="Send">
                <PaperPlaneRight size={16} weight="bold" />
              </Button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
              <Check
                label="Timestamps"
                checked={timestamps}
                onChange={(e) => setTimestamps(e.target.checked)}
              />
              <Check
                label="Autoscroll"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (setLines([]), setHint(null))}
                disabled={!lines.length}
              >
                Clear
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={save}
                disabled={!lines.length}
              >
                <DownloadSimple size={14} weight="bold" /> Save log
              </Button>
            </div>

            <details className="text-muted mt-5 text-sm">
              <summary className="text-fg cursor-pointer font-medium">
                Why does the port disappear?
              </summary>
              <p className="mt-2 leading-relaxed">
                On ESP32-S3 the USB port belongs to the bootloader until the
                firmware starts. When the firmware runs, the serial port closes
                and the board comes back as a security key. That switch is the
                sign the flash worked. For logs while the firmware runs, wire a
                USB-UART adapter to GPIO 43 (TX) and 44 (RX).
              </p>
            </details>
          </>
        )}
      </Panel>

      <div className="space-y-5 lg:sticky lg:top-24">
        <BoardStatusPanel boards={boards} />
        <Panel title="Activity">
          <LogView
            lines={activity.lines}
            onClear={activity.clear}
            emptyText="Board changes appear here."
            height="h-48"
          />
        </Panel>
      </div>
    </div>
  );
}
