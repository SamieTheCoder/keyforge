'use client';

import { PlugsConnected, ShieldWarning, SlidersHorizontal } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { BoardStatusPanel, useBoards } from '@/components/board-status';
import { LogView, useLog } from '@/components/log';
import { Button, Check, Help, Kbd, KeyValue, Label, Notice, Panel, Pill } from '@/components/ui';
import { useBrowserCaps } from '@/lib/caps';
import { formatBytes } from '@/lib/firmware';
import {
  BOARD_PRESETS,
  CURVES,
  DEFAULT_LED_GPIO,
  diffPhy,
  emptyPhy,
  GPIO_MAX,
  gpioRisk,
  hex16,
  isEsp,
  LED_DRIVERS,
  LED_ORDERS,
  MAX_BRIGHTNESS,
  PHY_OPT,
  reviewPhy,
  secureBootSlots,
  serializePhy,
  toHex,
  USB_ITF,
  USB_ITF_ALL,
  validatePhy,
  type BitOption,
  type DeviceInfo,
  type FlashInfo,
  type PhyConfig,
  type SecureBootStatus,
} from '@/lib/protocol';
import { cn } from '@/lib/utils';
import { CcidTransport, findWebCcidInterface, RescueSession, TimeoutError } from '@/lib/webusb';
import { LedPalette } from '@/components/led-palette';
import { WriteStatus, type WriteStage } from '@/components/write-status';

interface Loaded {
  info: DeviceInfo;
  flash: FlashInfo | null;
  secure: SecureBootStatus | null;
  current: PhyConfig;
  raw: Uint8Array;
}

export function Configurator() {
  const caps = useBrowserCaps();
  const { lines, log, clear } = useLog();
  const boards = useBoards(log);
  const session = useRef<RescueSession | null>(null);
  const [label, setLabel] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<PhyConfig>(emptyPhy());
  const [vidText, setVidText] = useState('');
  const [pidText, setPidText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showApdu, setShowApdu] = useState(false);
  const [review, setReview] = useState(false);
  const [sbAction, setSbAction] = useState<null | 'enable' | 'lock'>(null);
  const [stage, setStage] = useState<WriteStage>('idle');

  useEffect(
    () => () => {
      void session.current?.t.close();
    },
    []
  );

  useEffect(() => {
    if (!caps.usb) return;
    const onDisconnect = (e: USBConnectionEvent) => {
      if (session.current && e.device === session.current.t.device) {
        log('info', 'Key was unplugged.');
        session.current = null;
        setLoaded(null);
        setStage((s) => (s === 'saved' ? 'unplugged' : s));
      }
    };
    const onConnect = (e: USBConnectionEvent) => {
      // After a saved write, the replugged key comes back with the new settings.
      if (!findWebCcidInterface(e.device)) return;
      setStage((s) => {
        if (s !== 'unplugged' && s !== 'saved') return s;
        log('ok', 'Key reconnected. The new settings are active.');
        return 'applied';
      });
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    navigator.usb.addEventListener('connect', onConnect);
    return () => {
      navigator.usb.removeEventListener('disconnect', onDisconnect);
      navigator.usb.removeEventListener('connect', onConnect);
    };
  }, [caps.usb, log]);

  const mcu = loaded?.info.mcu ?? null;

  /* ---------------- connection ---------------- */

  const load = async (s: RescueSession) => {
    const info = await s.select();
    const flash = await s.readFlashInfo().catch((e: Error) => (log('error', e.message), null));
    const secure = await s.readSecureBoot().catch(() => null);
    const phy = await s.readPhy();
    if (phy.truncated) log('error', 'The configuration record on the key looks truncated. Showing what could be read.');
    setLoaded({ info, flash, secure, current: phy.config, raw: phy.raw });
    setDraft(structuredClone(phy.config));
    setVidText(phy.config.vid != null ? hex16(phy.config.vid) : hex16(s.t.device.vendorId));
    setPidText(phy.config.pid != null ? hex16(phy.config.pid) : hex16(s.t.device.productId));
    log('ok', `Read ${info.productName} ${info.version} on ${info.mcuName}.`);
  };

  const connect = async () => {
    setBusy(true);
    try {
      const device = await navigator.usb.requestDevice({ filters: [{ classCode: 0xff }] });
      const t = new CcidTransport(device, (k, text) => log(k, text));
      await t.open();
      const s = new RescueSession(t);
      session.current = s;
      setLabel(t.label);
      log('info', `Connected to ${t.label}`);
      await load(s);
      void boards.scan();
    } catch (e) {
      const err = e as Error;
      if (err.name === 'NotFoundError') {
        log('info', 'No device selected. The key must be running pico-fido (not in bootloader mode).');
      } else if (err.name === 'SecurityError') {
        log('error', 'The browser blocked USB access. Open Keyforge over https or localhost.');
      } else {
        log('error', err.message);
      }
      await session.current?.t.close();
      session.current = null;
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await session.current?.t.close();
    session.current = null;
    setLoaded(null);
    log('info', 'Disconnected.');
  };

  const fail = (e: unknown) => {
    const err = e as Error & { sw?: number };
    if (err.sw === 0x6985) log('error', 'The key did not get a BOOT-button press in time. Nothing was changed.');
    log('error', err.message);
    if (err instanceof TimeoutError || session.current?.t.closed) {
      log('error', 'Connection closed. Replug the key and connect again.');
      session.current = null;
      setLoaded(null);
    }
  };

  /* ---------------- form helpers ---------------- */

  const set = <K extends keyof PhyConfig>(k: K, v: PhyConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setOpt = (bit: number, on: boolean) => setDraft((d) => ({ ...d, opts: on ? d.opts | bit : d.opts & ~bit }));

  const vidPidOn = draft.vid != null;
  const vidPidError = vidPidOn && (!/^[0-9a-f]{4}$/i.test(vidText) || !/^[0-9a-f]{4}$/i.test(pidText));
  const effective: PhyConfig = vidPidOn && !vidPidError ? { ...draft, vid: parseInt(vidText, 16), pid: parseInt(pidText, 16) } : draft;
  const errors = [...(vidPidError ? ['VID and PID must be 4 hex digits.'] : []), ...validatePhy(effective)];
  let nextHex = '';
  if (!errors.length) {
    try {
      nextHex = toHex(serializePhy(effective));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  const dirty = !!loaded && nextHex !== '' && nextHex !== toHex(serializePhy(loaded.current));
  const gpioCheck = gpioRisk(mcu, draft.ledGpio);
  const presets = BOARD_PRESETS.filter((p) => mcu == null || p.mcu === mcu);
  const drivers = LED_DRIVERS.filter((d) => mcu == null || d.platform === 'any' || (d.platform === 'esp') === isEsp(mcu));

  const write = async () => {
    if (!session.current || !loaded) return;
    setReview(false);
    setBusy(true);
    setStage('writing');
    log('wait', 'Writing configuration. Press BOOT on the board when the LED blinks yellow.');
    try {
      await session.current.writePhy(effective);
      setStage('saved');
      log('ok', 'Configuration saved on the key. Unplug it and plug it back in to apply.');
      await load(session.current);
    } catch (e) {
      setStage('failed');
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const burn = async (lock: boolean, slot: number) => {
    if (!session.current) return;
    setSbAction(null);
    setBusy(true);
    log('wait', `${lock ? 'Locking' : 'Enabling'} secure boot in slot ${slot}. Press BOOT when the LED blinks yellow.`);
    try {
      await session.current.enableSecureBoot(slot, lock);
      log('ok', `Secure boot ${lock ? 'locked' : 'enabled'}.`);
      await load(session.current);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- render ---------------- */

  const side = (
    <div className="space-y-5 lg:sticky lg:top-24">
      <BoardStatusPanel boards={boards} />
      <Panel title="Activity" actions={<Check label="Show APDUs" checked={showApdu} onChange={(e) => setShowApdu(e.target.checked)} />}>
        <LogView lines={lines} onClear={clear} showApdu={showApdu} emptyText="Connect a key to begin." height="h-72" />
      </Panel>
    </div>
  );

  if (!loaded) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="space-y-5">
        <WriteStatus stage={stage} onDismiss={() => setStage('idle')} />
        <Panel>
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span className="grid size-14 shrink-0 place-items-center rounded-[14px] border border-accent-line bg-accent-soft text-accent">
              <SlidersHorizontal size={28} weight="duotone" />
            </span>
            <div className="flex-1">
              <p className="text-lg font-semibold">Connect a running key</p>
              <p className="mt-1 text-sm text-muted">
                The key must be running pico-fido, not sitting in the bootloader. No PIN, admin rights or smart-card driver are needed.
              </p>
            </div>
            <Button variant="primary" size="lg" onClick={connect} disabled={busy || (caps.ready && !caps.usb)}>
              <PlugsConnected size={18} weight="bold" /> Connect key
            </Button>
          </div>
          {caps.ready && !caps.usb && (
            <Notice tone="danger" className="mt-5" title="WebUSB is not available">
              Use Chrome, Edge or another Chromium browser on desktop.
            </Notice>
          )}
          <ul className="mt-6 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <li className="rounded-[10px] border border-line bg-sunken px-4 py-3">Close the PicoKey web app or other tabs that use the key. Only one can hold it.</li>
            <li className="rounded-[10px] border border-line bg-sunken px-4 py-3">In the device chooser, pick the key (usually “Pico Key”), not the ESP32 bootloader.</li>
          </ul>
        </Panel>
        </div>
        {side}
      </div>
    );
  }

  const { info, flash, secure } = loaded;
  const slots = secureBootSlots(info.mcu);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <div className="space-y-5">
        <WriteStatus stage={stage} onDismiss={() => setStage('idle')} />
        <Panel
          title="Device"
          actions={
            <>
              <Button size="sm" onClick={() => session.current && load(session.current).catch(fail)} disabled={busy}>
                Reload
              </Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </>
          }
        >
          <KeyValue
            rows={[
              ['Firmware', `${info.productName} ${info.version}${info.build != null ? ` (build ${info.build})` : ''}`],
              ['MCU', info.mcuName],
              ['Serial', info.serialHex],
              ['USB device', label],
              ...(flash
                ? ([
                    ['Storage', `${formatBytes(flash.used)} used of ${formatBytes(flash.total)}, ${flash.files ?? '?'} files`],
                    ...(flash.chipSize ? ([['Flash chip', formatBytes(flash.chipSize)]] as [string, string][]) : []),
                  ] as [string, string][])
                : []),
            ]}
          />
        </Panel>

        <Panel title="Status LED">
          {presets.length > 0 && (
            <div className="mb-5">
              <Label htmlFor="preset">Board preset</Label>
              <select
                id="preset"
                className="field-input"
                value=""
                onChange={(e) => {
                  const p = BOARD_PRESETS.find((x) => x.id === e.target.value);
                  if (!p) return;
                  setDraft((d) => ({ ...d, ...p.apply }));
                  log('info', `Preset applied: ${p.name}. Review and write to save.`);
                }}
              >
                <option value="">Fill in LED settings for a board</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="drv">LED driver</Label>
              <select
                id="drv"
                className="field-input"
                value={draft.ledDriver ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setDraft((d) => ({ ...d, ledDriver: v, ledOrder: v == null ? null : d.ledOrder }));
                }}
              >
                <option value="">Firmware default</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <Help>ESP32 boards use the NeoPixel driver.</Help>
            </div>
            <div>
              <Label htmlFor="order">Channel order</Label>
              <select
                id="order"
                className="field-input"
                value={draft.ledOrder ?? ''}
                disabled={draft.ledDriver == null}
                onChange={(e) => set('ledOrder', e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Firmware default (RGB)</option>
                {LED_ORDERS.map((o, i) => (
                  <option key={o} value={i}>
                    {o}
                  </option>
                ))}
              </select>
              <Help>Same setting as the palette below, shown as the raw channel order.</Help>
            </div>
            <div>
              <Label htmlFor="gpio">LED GPIO pin</Label>
              <div className="flex gap-2">
                <select
                  aria-label="GPIO mode"
                  className="field-input w-auto"
                  value={draft.ledGpio == null ? 'default' : 'custom'}
                  onChange={(e) => set('ledGpio', e.target.value === 'default' ? null : (DEFAULT_LED_GPIO[info.mcu] ?? 0))}
                >
                  <option value="default">Default</option>
                  <option value="custom">Custom</option>
                </select>
                <input
                  id="gpio"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={GPIO_MAX[info.mcu] ?? 255}
                  className="field-input"
                  disabled={draft.ledGpio == null}
                  value={draft.ledGpio ?? DEFAULT_LED_GPIO[info.mcu] ?? ''}
                  aria-invalid={gpioCheck?.level === 'block' || undefined}
                  aria-describedby="gpio-help"
                  onChange={(e) => set('ledGpio', e.target.value === '' ? 0 : Math.trunc(Number(e.target.value)))}
                />
              </div>
              <p
                id="gpio-help"
                className={cn('mt-1.5 text-[12.5px]', gpioCheck?.level === 'block' ? 'font-medium text-danger' : gpioCheck ? 'font-medium text-warn' : 'text-muted')}
              >
                {gpioCheck
                  ? gpioCheck.reason
                  : DEFAULT_LED_GPIO[info.mcu] != null
                    ? `Default on ${info.mcuName} is GPIO ${DEFAULT_LED_GPIO[info.mcu]}. Waveshare ESP32-S3-Zero uses GPIO 21.`
                    : 'Default depends on the board the firmware was built for.'}
              </p>
            </div>
            <div>
              <Label htmlFor="bright">
                Brightness{' '}
                <span className="font-mono text-muted">{draft.ledBrightness == null ? 'default' : `${draft.ledBrightness}/${MAX_BRIGHTNESS}`}</span>
              </Label>
              <input
                id="bright"
                type="range"
                min={0}
                max={MAX_BRIGHTNESS}
                className="w-full"
                disabled={draft.ledBrightness == null}
                value={draft.ledBrightness ?? MAX_BRIGHTNESS}
                onChange={(e) => set('ledBrightness', Number(e.target.value))}
              />
              <Check
                label="Firmware default (maximum)"
                checked={draft.ledBrightness == null}
                onChange={(e) => set('ledBrightness', e.target.checked ? null : MAX_BRIGHTNESS)}
              />
            </div>
          </div>
          <div className="mt-5 border-t border-line pt-5">
            <LedPalette
              value={draft.ledOrder}
              brightness={draft.ledBrightness}
              disabled={draft.ledDriver == null && !isEsp(mcu)}
              onChange={(o) =>
                setDraft((d) => ({ ...d, ledOrder: o, ledDriver: d.ledDriver ?? (isEsp(mcu) ? 0x05 : d.ledDriver) }))
              }
            />
            {draft.ledDriver == null && !isEsp(mcu) && <Help>Pick an LED driver above to choose colours.</Help>}
          </div>
          <div className="mt-4 grid gap-1 border-t border-line pt-4 sm:grid-cols-2">
            <Check label="Dimmable (smooth fade)" checked={!!(draft.opts & PHY_OPT.DIMM)} onChange={(e) => setOpt(PHY_OPT.DIMM, e.target.checked)} />
            <Check label="Steady (no blinking)" checked={!!(draft.opts & PHY_OPT.LED_STEADY)} onChange={(e) => setOpt(PHY_OPT.LED_STEADY, e.target.checked)} />
          </div>
        </Panel>

        <Panel title="User presence and power">
          <Check
            label="Require a BOOT-button press to confirm operations"
            checked={draft.upBtn != null && draft.upBtn > 0}
            onChange={(e) => set('upBtn', e.target.checked ? 15 : null)}
          />
          <div className="mt-3 max-w-xs">
            <Label htmlFor="upbtn">Timeout in seconds</Label>
            <input
              id="upbtn"
              type="number"
              min={1}
              max={255}
              className="field-input"
              disabled={!(draft.upBtn != null && draft.upBtn > 0)}
              value={draft.upBtn ?? 15}
              onChange={(e) => set('upBtn', Math.max(1, Math.min(255, Math.trunc(Number(e.target.value) || 1))))}
            />
          </div>
          <Check
            className="mt-3"
            label="Power-cycle on reset"
            checked={!(draft.opts & PHY_OPT.DISABLE_POWER_RESET)}
            onChange={(e) => setOpt(PHY_OPT.DISABLE_POWER_RESET, !e.target.checked)}
          />
        </Panel>

        <Panel title="USB identity">
          <Check
            label="Override USB VID:PID"
            checked={vidPidOn}
            onChange={(e) => setDraft((d) => ({ ...d, vid: e.target.checked ? 0 : null, pid: e.target.checked ? 0 : null }))}
          />
          <div className="mt-2 flex flex-wrap gap-4">
            {[
              ['VID', vidText, setVidText],
              ['PID', pidText, setPidText],
            ].map(([name, val, setter]) => (
              <div key={name as string}>
                <Label htmlFor={`id-${name}`}>{name as string}</Label>
                <input
                  id={`id-${name}`}
                  className="field-input w-28 font-mono uppercase"
                  maxLength={4}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!vidPidOn}
                  aria-invalid={(vidPidOn && !/^[0-9a-f]{4}$/i.test(val as string)) || undefined}
                  value={val as string}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value.trim())}
                />
              </div>
            ))}
          </div>
          <Help>Only use IDs you are allowed to use. Never distribute devices with a VID/PID you do not own.</Help>
          <Check
            className="mt-4"
            label="Override USB product name"
            checked={draft.usbProduct != null}
            onChange={(e) => set('usbProduct', e.target.checked ? (session.current?.t.device.productName ?? 'Pico Key') : null)}
          />
          <input
            aria-label="USB product name"
            className="field-input mt-2 max-w-sm"
            maxLength={31}
            disabled={draft.usbProduct == null}
            value={draft.usbProduct ?? ''}
            onChange={(e) => set('usbProduct', e.target.value)}
          />
        </Panel>

        <Panel title="USB interfaces and curves">
          <div className="grid gap-6 md:grid-cols-2">
            <BitGroup title="Interfaces" table={USB_ITF} value={draft.usbItf} all={USB_ITF_ALL} onChange={(v) => set('usbItf', v)} />
            <BitGroup title="Curves" table={CURVES} value={draft.curves} all={0x8f} onChange={(v) => set('curves', v)} />
          </div>
        </Panel>

        <div className="panel sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          {errors.length > 0 && <p className="mr-auto text-[13px] font-medium text-danger">{errors[0]}</p>}
          {!errors.length && dirty && <p className="mr-auto text-[13px] text-muted">Unsaved changes</p>}
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(structuredClone(loaded.current));
              setVidText(loaded.current.vid != null ? hex16(loaded.current.vid) : vidText);
              setPidText(loaded.current.pid != null ? hex16(loaded.current.pid) : pidText);
            }}
          >
            Revert
          </Button>
          <Button variant="primary" disabled={!dirty || busy || errors.length > 0} onClick={() => setReview(true)}>
            Review and write
          </Button>
        </div>

        <Panel title="Secure boot" tone="danger">
          {slots == null ? (
            <p className="text-sm text-muted">{info.mcuName} has no secure boot support in pico-fido.</p>
          ) : (
            <SecureBoot status={secure} slots={slots} busy={busy} mcuName={info.mcuName} onAsk={setSbAction} />
          )}
        </Panel>

        <details className="panel p-5 text-sm">
          <summary className="cursor-pointer font-medium">Raw configuration record</summary>
          <p className="mt-3 text-muted">On key</p>
          <code className="mt-1 block rounded-[10px] bg-sunken p-3 font-mono text-xs break-all">{toHex(loaded.raw) || '(empty)'}</code>
          <p className="mt-3 text-muted">Will be written</p>
          <code className="mt-1 block rounded-[10px] bg-sunken p-3 font-mono text-xs break-all">{nextHex || 'n/a'}</code>
        </details>
      </div>

      {side}

      {review && (
        <ReviewDialog
          before={loaded.current}
          after={effective}
          mcu={info.mcu}
          onCancel={() => setReview(false)}
          onConfirm={write}
        />
      )}
      {sbAction && slots != null && (
        <SecureBootDialog
          lock={sbAction === 'lock'}
          slots={slots}
          defaultSlot={secure?.bootKey ?? 0}
          info={info}
          onCancel={() => setSbAction(null)}
          onConfirm={burn}
        />
      )}
    </div>
  );
}

function BitGroup({
  title,
  table,
  value,
  all,
  onChange,
}: {
  title: string;
  table: readonly BitOption[];
  value: number | null;
  all: number;
  onChange: (v: number | null) => void;
}) {
  const mask = value ?? all;
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium">{title}</legend>
      <Check label="Firmware default" checked={value == null} onChange={(e) => onChange(e.target.checked ? null : all)} />
      <div className={cn('mt-1 border-l border-line pl-3', value == null && 'opacity-50')}>
        {table.map((t) => (
          <Check
            key={t.bit}
            label={t.name}
            disabled={value == null}
            checked={(mask & t.bit) !== 0}
            onChange={(e) => onChange(e.target.checked ? mask | t.bit : mask & ~t.bit)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[16px] border border-line bg-panel-solid p-6 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id="modal-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}

function ReviewDialog({
  before,
  after,
  mcu,
  onCancel,
  onConfirm,
}: {
  before: PhyConfig;
  after: PhyConfig;
  mcu: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { errors, warnings } = reviewPhy(before, after, mcu);
  const [ack, setAck] = useState(false);
  const rows = diffPhy(before, after);
  return (
    <Modal title="Review changes" onClose={onCancel}>
      <div className="overflow-hidden rounded-[10px] border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-left text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Setting</th>
              <th className="px-3 py-2 font-medium">On key</th>
              <th className="px-3 py-2 font-medium">New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {k}
                </th>
                <td className="px-3 py-2 text-muted">{a}</td>
                <td className="px-3 py-2 font-medium text-accent">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-2">
        {errors.map((e) => (
          <Notice key={e} tone="danger">
            {e}
          </Notice>
        ))}
        {warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        {warnings.length > 0 && <Check label="I understand the warnings above" checked={ack} onChange={(e) => setAck(e.target.checked)} />}
        <Notice>
          After you click Write, press <Kbd>BOOT</Kbd> on the board when the LED blinks yellow. Then unplug and replug the key.
        </Notice>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={errors.length > 0 || (warnings.length > 0 && !ack)} onClick={onConfirm}>
          Write to key
        </Button>
      </div>
    </Modal>
  );
}

function SecureBoot({
  status,
  slots,
  busy,
  mcuName,
  onAsk,
}: {
  status: SecureBootStatus | null;
  slots: number;
  busy: boolean;
  mcuName: string;
  onAsk: (a: 'enable' | 'lock') => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Pill tone={status?.enabled ? 'danger' : 'neutral'}>Secure boot {status?.enabled ? 'enabled' : 'off'}</Pill>
        <Pill tone={status?.locked ? 'danger' : 'neutral'}>{status?.locked ? 'Locked' : 'Not locked'}</Pill>
        {status?.bootKey != null && <Pill>Key slot {status.bootKey}</Pill>}
      </div>
      <Notice tone="danger" title="Permanent. It burns eFuses that can never be cleared.">
        <ul className="list-disc space-y-1 pl-5">
          <li>Afterwards {mcuName} only boots firmware signed with the PicoKeys release key. Your own builds stop working.</li>
          <li>If the firmware on the board is not an official signed build, it will not start after the next reset.</li>
          <li>Lock also revokes the other {slots - 1} key slots and disables JTAG. Secure boot must be enabled first.</li>
        </ul>
      </Notice>
      <Check label="I understand this cannot be undone" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!understood || busy || !!status?.enabled} onClick={() => onAsk('enable')}>
          <ShieldWarning size={16} weight="bold" /> Enable secure boot
        </Button>
        <Button variant="danger" disabled={!understood || busy || !status?.enabled || !!status?.locked} onClick={() => onAsk('lock')}>
          Lock secure boot
        </Button>
      </div>
    </div>
  );
}

function SecureBootDialog({
  lock,
  slots,
  defaultSlot,
  info,
  onCancel,
  onConfirm,
}: {
  lock: boolean;
  slots: number;
  defaultSlot: number;
  info: DeviceInfo;
  onCancel: () => void;
  onConfirm: (lock: boolean, slot: number) => void;
}) {
  const phrase = lock ? 'LOCK SECURE BOOT' : 'ENABLE SECURE BOOT';
  const [typed, setTyped] = useState('');
  const [slot, setSlot] = useState(defaultSlot);
  return (
    <Modal title={lock ? 'Lock secure boot (permanent)' : 'Enable secure boot (permanent)'} onClose={onCancel}>
      <p className="text-sm text-muted">
        {lock
          ? `This revokes every other boot key slot and disables JTAG on ${info.mcuName} serial ${info.serialHex}.`
          : `This burns the PicoKeys release-key digest into a key slot and turns on secure boot for ${info.mcuName} serial ${info.serialHex}.`}{' '}
        It can never be undone.
      </p>
      {!lock && (
        <div className="mt-4 max-w-40">
          <Label htmlFor="sb-slot">Key slot</Label>
          <select id="sb-slot" className="field-input" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {Array.from({ length: slots }, (_, i) => (
              <option key={i} value={i}>
                Slot {i}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mt-4">
        <Label htmlFor="sb-phrase">
          Type <code className="font-mono text-danger">{phrase}</code> to continue
        </Label>
        <input id="sb-phrase" className="field-input font-mono" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" disabled={typed.trim() !== phrase} onClick={() => onConfirm(lock, lock ? defaultSlot : slot)}>
          Burn eFuses
        </Button>
      </div>
    </Modal>
  );
}
