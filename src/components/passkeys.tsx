'use client';

import { Key, LockKey, LockKeyOpen, PlugsConnected, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { LogView, useLog } from '@/components/log';
import { Button, Check, Help, KeyValue, Label, Notice, Panel, Pill } from '@/components/ui';
import { useBrowserCaps } from '@/lib/caps';
import { CtapError, FidoSession, type AuthenticatorInfo, type RelyingParty } from '@/lib/ctap';
import { toHex } from '@/lib/protocol';
import { cn } from '@/lib/utils';
import { CcidTransport } from '@/lib/webusb';

type PinMode = 'set' | 'change';

const STORAGE_STEP = 'reading passkey storage';

export function Passkeys() {
  const caps = useBrowserCaps();
  const { lines, log, clear } = useLog();
  const transport = useRef<CcidTransport | null>(null);
  const fido = useRef<FidoSession | null>(null);
  const [info, setInfo] = useState<AuthenticatorInfo | null>(null);
  const [retries, setRetries] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [rps, setRps] = useState<RelyingParty[] | null>(null);
  const [storage, setStorage] = useState<{ existing: number; remaining: number } | null>(null);
  const [showApdu, setShowApdu] = useState(false);
  const [toDelete, setToDelete] = useState<{ rp: string; user: string; id: Uint8Array } | null>(null);
  const pending = useRef<string | null>(null);
  const [crashedOn, setCrashedOn] = useState<string | null>(null);
  // Set when storage info crashed the key, so the next unlock goes straight to the list.
  const skipStorage = useRef(false);

  useEffect(
    () => () => {
      void transport.current?.close();
    },
    []
  );

  useEffect(() => {
    if (!caps.usb) return;
    const onDisconnect = (e: USBConnectionEvent) => {
      if (transport.current && e.device === transport.current.device) {
        const during = pending.current;
        if (during) {
          log(
            'error',
            `The key restarted by itself while "${during}" was running. That is a firmware crash on the key, not a USB unplug. Nothing was changed. Click Connect key to continue; if it happens again, this firmware build cannot do "${during}" over USB smart card.`
          );
          setCrashedOn(during);
          if (during === STORAGE_STEP) {
            skipStorage.current = true;
            log('info', 'Next time you unlock, Keyforge will skip storage info and go straight to the passkey list.');
          }
        } else {
          log('info', 'Key was unplugged. Passkey list cleared from this page.');
        }
        reset();
      }
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => navigator.usb.removeEventListener('disconnect', onDisconnect);
  }, [caps.usb, log]);

  function reset() {
    transport.current = null;
    fido.current = null;
    setInfo(null);
    setRetries(null);
    setUnlocked(false);
    setRps(null);
    setStorage(null);
  }

  const refreshInfo = async () => {
    const f = fido.current!;
    const i = await f.info();
    setInfo(i);
    setRetries(i.pinSet ? await f.pinRetries().catch(() => null) : null);
    return i;
  };

  const connect = async () => {
    setBusy(true);
    try {
      const device = await navigator.usb.requestDevice({ filters: [{ classCode: 0xff }] });
      const t = new CcidTransport(device, (k, text) => log(k, text));
      await t.open();
      transport.current = t;
      const f = new FidoSession(t);
      await f.select();
      fido.current = f;
      const i = await refreshInfo();
      log('ok', `Connected to ${t.label}. ${i.pinSet ? 'A PIN is set.' : 'No PIN is set yet.'}`);
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'NotFoundError') log('error', err.message);
      await transport.current?.close();
      reset();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    fido.current?.lock();
    await transport.current?.close();
    reset();
    log('info', 'Disconnected.');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      // If the key vanished, the disconnect handler already explained why.
      if (!transport.current && /transfer|disconnected|closed/i.test((e as Error).message)) return;
      log('error', (e as Error).message);
      if (e instanceof CtapError && [0x31, 0x32, 0x34].includes(e.code)) await refreshInfo().catch(() => {});
      if (transport.current?.closed) {
        log('error', 'Connection closed. Replug the key and connect again.');
        reset();
      }
    } finally {
      setBusy(false);
    }
  };

  const savePin = (mode: PinMode, current: string, next: string) =>
    run(async () => {
      const f = fido.current!;
      if (mode === 'set') await step('setting the PIN', () => f.setPin(next));
      else await step('changing the PIN', () => f.changePin(current, next));
      setUnlocked(false);
      setRps(null);
      setStorage(null);
      log('ok', mode === 'set' ? 'PIN set. Use it whenever a site asks for your security key PIN.' : 'PIN changed.');
      await refreshInfo();
    });

  const unlock = (pin: string) =>
    run(async () => {
      const f = fido.current!;
      await step('unlocking with the PIN', () => f.unlock(pin));
      setUnlocked(true);
      log('ok', 'Unlocked. Reading passkeys.');
      await loadPasskeys();
      setRetries(await f.pinRetries().catch(() => null));
    });

  /** Run one key command with a human name, so a crash can be attributed to it. */
  const step = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    pending.current = name;
    try {
      return await fn();
    } finally {
      pending.current = null;
    }
  };

  const loadPasskeys = async () => {
    const f = fido.current!;
    setCrashedOn(null);
    // Storage info is optional: some firmware builds reject it.
    if (skipStorage.current) {
      log('info', 'Skipping storage info, which crashed this key last time.');
    } else {
      try {
        setStorage(await step(STORAGE_STEP, () => f.metadata()));
      } catch (e) {
        if (!transport.current) throw e;
        log('info', `Storage info unavailable: ${(e as Error).message}`);
      }
    }
    const list = await step('listing passkeys', () => f.listPasskeys());
    setRps(list);
    log('info', `Found ${list.reduce((n, r) => n + r.passkeys.length, 0)} passkeys on ${list.length} sites.`);
  };

  const lock = () => {
    fido.current?.lock();
    setUnlocked(false);
    setRps(null);
    setStorage(null);
    log('info', 'Locked. Passkey list cleared from this page.');
  };

  const confirmDelete = () =>
    run(async () => {
      if (!toDelete) return;
      const target = toDelete;
      setToDelete(null);
      await step('deleting a passkey', () => fido.current!.deletePasskey(target.id));
      log('ok', `Deleted the passkey for ${target.user || 'unnamed user'} on ${target.rp}.`);
      await loadPasskeys();
    });

  const side = (
    <div className="space-y-5 lg:sticky lg:top-24">
      <Panel title="Privacy">
        <p className="text-sm leading-relaxed text-muted">
          Your PIN is encrypted in this tab before it is sent to the key, and the passkey list exists only on this page. Nothing is
          uploaded or stored. Lock or unplug the key to clear it.
        </p>
      </Panel>
      <Panel title="Activity" actions={<Check label="Show APDUs" checked={showApdu} onChange={(e) => setShowApdu(e.target.checked)} />}>
        <LogView lines={lines} onClear={clear} showApdu={showApdu} emptyText="Connect a key to begin." height="h-64" />
      </Panel>
    </div>
  );

  if (!info) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <Panel>
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span className="grid size-14 shrink-0 place-items-center rounded-[14px] border border-accent-line bg-accent-soft text-accent">
              <Key size={28} weight="duotone" />
            </span>
            <div className="flex-1">
              <p className="text-lg font-semibold">Connect your key</p>
              <p className="mt-1 text-sm text-muted">Set or change the FIDO PIN, see how much storage is left, and remove passkeys you no longer use.</p>
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
          {crashedOn && (
            <Notice tone="warn" className="mt-5" title={`The key restarted while ${crashedOn}`}>
              Your passkeys and PIN are safe; a restart does not erase anything. The firmware crashed handling this request over the USB
              smart-card interface. Connect again to retry. If it repeats, update to the latest pico-fido release on the Flash page.
            </Notice>
          )}
          <Notice className="mt-5">
            Works with pico-fido keys whose USB smart-card interface is enabled (the default). It talks to the key the same way the
            Configure page does, so close that page first.
          </Notice>
        </Panel>
        {side}
      </div>
    );
  }

  const total = rps?.reduce((n, r) => n + r.passkeys.length, 0) ?? 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="space-y-5">
        <Panel
          title="Key"
          actions={
            <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill tone={info.pinSet ? 'ok' : 'warn'}>{info.pinSet ? 'PIN set' : 'No PIN'}</Pill>
            {retries != null && <Pill tone={retries <= 3 ? 'danger' : 'neutral'}>{retries} PIN attempts left</Pill>}
            {info.credMgmt ? <Pill tone="accent">Passkey management supported</Pill> : <Pill>No passkey management</Pill>}
          </div>
          <KeyValue
            rows={[
              ['FIDO versions', info.versions.join(', ') || 'n/a'],
              ['Minimum PIN length', String(info.minPinLength)],
              ['AAGUID', info.aaguid || 'n/a'],
            ]}
          />
          {retries != null && retries <= 3 && (
            <Notice tone="danger" className="mt-4" title={`Only ${retries} PIN attempts left`}>
              When they run out the PIN is blocked, and the only way back is a reset that erases every passkey on the key.
            </Notice>
          )}
        </Panel>

        <PinForm mode={info.pinSet ? 'change' : 'set'} minLength={info.minPinLength} busy={busy} onSubmit={savePin} />

        {info.pinSet && info.credMgmt && (
          <Panel
            title="Passkeys on this key"
            actions={
              unlocked ? (
                <>
                  <Button size="sm" onClick={() => run(loadPasskeys)} disabled={busy}>
                    Reload
                  </Button>
                  <Button size="sm" variant="ghost" onClick={lock} disabled={busy}>
                    <LockKey size={14} weight="bold" /> Lock
                  </Button>
                </>
              ) : null
            }
          >
            {!unlocked ? (
              <UnlockForm busy={busy} onUnlock={unlock} />
            ) : (
              <div className="space-y-5">
                {storage && <StorageMeter used={storage.existing} free={storage.remaining} />}
                {rps && rps.length === 0 && (
                  <div className="rounded-[12px] border border-dashed border-line-strong p-8 text-center">
                    <p className="font-medium">No passkeys yet</p>
                    <p className="mt-1 text-sm text-muted">Passkeys you save to this key on websites will show up here.</p>
                  </div>
                )}
                {rps && rps.length > 0 && (
                  <ul className="space-y-3" aria-label={`${total} passkeys`}>
                    {rps.map((rp) => (
                      <li key={toHex(rp.rpIdHash, '')} className="rounded-[12px] border border-line bg-raised">
                        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                          <span className="grid size-9 place-items-center rounded-[10px] bg-accent-soft font-mono text-sm font-semibold text-accent uppercase">
                            {rp.id.replace(/^www\./, '').charAt(0) || '?'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{rp.name || rp.id}</p>
                            {rp.name && rp.name !== rp.id && <p className="truncate font-mono text-xs text-muted">{rp.id}</p>}
                          </div>
                          <Pill>{rp.passkeys.length}</Pill>
                        </div>
                        <ul>
                          {rp.passkeys.map((pk) => (
                            <li key={toHex(pk.credentialId, '')} className="flex items-center gap-3 px-4 py-3 [&+li]:border-t [&+li]:border-line">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">{pk.displayName || pk.userName || 'Unnamed account'}</p>
                                {pk.userName && pk.displayName && pk.userName !== pk.displayName && (
                                  <p className="truncate text-xs text-muted">{pk.userName}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-danger hover:text-danger"
                                disabled={busy}
                                aria-label={`Delete passkey for ${pk.userName || pk.displayName || 'account'} on ${rp.id}`}
                                onClick={() => setToDelete({ rp: rp.id, user: pk.userName || pk.displayName, id: pk.credentialId })}
                              >
                                <Trash size={15} weight="bold" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                {!rps && <div className="h-24 animate-pulse rounded-[12px] bg-sunken" aria-label="Loading passkeys" />}
              </div>
            )}
          </Panel>
        )}
        {!info.pinSet && (
          <Notice title="Set a PIN to see your passkeys">Listing and deleting passkeys needs a PIN, so the key knows it is you.</Notice>
        )}
      </div>
      {side}

      {toDelete && (
        <ConfirmDelete target={toDelete} busy={busy} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}

function StorageMeter({ used, free }: { used: number; free: number }) {
  const total = used + free;
  const pct = total ? (used / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[13px]">
        <span className="text-muted">Passkey storage</span>
        <span className="font-mono">
          {used} used, {free} free
        </span>
      </div>
      <div
        role="meter"
        aria-label="Passkey storage used"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        className="h-2 overflow-hidden rounded-full bg-sunken"
      >
        <div className={cn('h-full rounded-full', pct > 85 ? 'bg-warn' : 'bg-gradient-to-r from-accent-3 to-accent')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PinForm({
  mode,
  minLength,
  busy,
  onSubmit,
}: {
  mode: PinMode;
  minLength: number;
  busy: boolean;
  onSubmit: (mode: PinMode, current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const bytes = new TextEncoder().encode(next).length;
  const error =
    next && [...next].length < minLength
      ? `PIN must be at least ${minLength} characters.`
      : bytes > 63
        ? 'PIN is too long.'
        : confirm && confirm !== next
          ? 'The two PINs do not match.'
          : mode === 'change' && next && next === current
            ? 'The new PIN is the same as the current one.'
            : null;
  const ready = !error && next && confirm === next && (mode === 'set' || current);

  return (
    <Panel title={mode === 'set' ? 'Set a PIN' : 'Change PIN'}>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          await onSubmit(mode, current, next);
          setCurrent('');
          setNext('');
          setConfirm('');
        }}
      >
        {mode === 'change' && (
          <div>
            <Label htmlFor="pin-cur">Current PIN</Label>
            <input id="pin-cur" type="password" autoComplete="current-password" className="field-input" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="pin-new">New PIN</Label>
          <input
            id="pin-new"
            type="password"
            autoComplete="new-password"
            className="field-input"
            aria-invalid={!!error || undefined}
            aria-describedby="pin-help"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pin-confirm">Confirm new PIN</Label>
          <input id="pin-confirm" type="password" autoComplete="new-password" className="field-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={!ready || busy}>
            {mode === 'set' ? 'Set PIN' : 'Change PIN'}
          </Button>
          <p id="pin-help" className={cn('text-[13px]', error ? 'font-medium text-danger' : 'text-muted')}>
            {error ?? `At least ${minLength} characters. Letters and symbols are allowed.`}
          </p>
        </div>
      </form>
      {mode === 'set' && (
        <Help className="mt-4">
          Websites ask for this PIN when you sign in with the key. If you forget it, the only fix is a reset that erases every passkey.
        </Help>
      )}
    </Panel>
  );
}

function UnlockForm({ busy, onUnlock }: { busy: boolean; onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!pin) return;
        await onUnlock(pin);
        setPin('');
      }}
    >
      <div className="min-w-56 flex-1">
        <Label htmlFor="pin-unlock">Enter your PIN to list passkeys</Label>
        <input id="pin-unlock" type="password" autoComplete="current-password" className="field-input" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" disabled={!pin || busy}>
        <LockKeyOpen size={16} weight="bold" /> Unlock
      </Button>
    </form>
  );
}

function ConfirmDelete({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { rp: string; user: string };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="del-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-[16px] border border-line bg-panel-solid p-6 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id="del-title" className="text-lg font-semibold">
        Delete this passkey?
      </h2>
      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-fg">{target.user || 'Unnamed account'}</span> on <span className="font-mono text-fg">{target.rp}</span>.
        You will not be able to sign in to this account with this key any more. This cannot be undone.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          <Trash size={15} weight="bold" /> Delete passkey
        </Button>
      </div>
    </dialog>
  );
}
