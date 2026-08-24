'use client';

import { Cpu, DownloadSimple, FileArrowUp, FolderOpen, Lightning, PlugsConnected } from '@phosphor-icons/react';
import type { ESPLoader, Transport } from 'esptool-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardStatusPanel, useBoards } from '@/components/board-status';
import { LogView, Progress, useLog } from '@/components/log';
import { Button, Check, Help, Kbd, KeyValue, Label, Notice, Panel, Pill } from '@/components/ui';
import { ESPRESSIF_VID } from '@/lib/boards';
import { useBrowserCaps } from '@/lib/caps';
import {
  bootDriveChip,
  FIRMWARE_SOURCES,
  formatBytes,
  inspectEspImage,
  matchAssets,
  md5Hex,
  normaliseChip,
  parseUf2,
  planEspFlash,
  planUf2Copy,
  TARGETS,
  uf2ToFlashImage,
  type Asset,
  type FlashImage,
  type GithubRelease,
  type TargetId,
} from '@/lib/firmware';
import { decodeRpSecurity, OTP_SECURITY_ROW, OTP_SECURITY_ROWS, Picoboot, type RpSecurity } from '@/lib/picoboot';
import { downloadFirmware, fetchReleases } from '@/lib/releases';
import { cn } from '@/lib/utils';

interface Firmware {
  name: string;
  bytes: Uint8Array;
  origin: string;
  picoKeysSigned: boolean;
}

interface EspSession {
  loader: ESPLoader;
  transport: Transport;
  chip: string;
  features: string[];
  mac: string;
  flashSize: string | null;
}

interface RpSession {
  pb: Picoboot;
  /** RP2350 only; null if the OTP read failed or the chip is an RP2040. */
  security: RpSecurity | null;
}

// Minimal File System Access typings (Chromium only).
interface FsWritable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
interface FsDirHandle {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
}
type DirPicker = (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>;

/** Native Espressif USB plus the USB-UART chips found on most ESP32 boards. */
const SERIAL_FILTERS: SerialPortFilter[] = [
  { usbVendorId: ESPRESSIF_VID },
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x1a86 }, // WCH CH340 / CH343
  { usbVendorId: 0x0403 }, // FTDI
];

/** Inspect a UF2 for the chosen RP chip, including the RP2350 secure boot check. */
function uf2Check(bytes: Uint8Array, want: 'RP2040' | 'RP2350', sec: RpSecurity | null) {
  let u: ReturnType<typeof parseUf2>;
  try {
    u = parseUf2(bytes);
  } catch (e) {
    return { rows: [] as [string, string][], errors: [(e as Error).message], warnings: [] as string[], address: null, image: null };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (u.target && u.target !== 'RP2xxx' && u.target !== want) errors.push(`This UF2 is for ${u.target}, not ${want}.`);
  const rows: [string, string][] = [
    ['Built for', u.target ?? 'unknown'],
    ['Blocks', String(u.blocks)],
    ['Payload', formatBytes(u.payload)],
  ];
  let image: FlashImage | null = null;
  if (!errors.length) {
    try {
      image = uf2ToFlashImage(bytes, want);
    } catch (e) {
      warnings.push(`${(e as Error).message} Flash over USB is unavailable for this file.`);
    }
  }
  if (image) {
    rows.push(['Flash used', `${formatBytes(image.bytes)} from 0x${image.sectors[0].addr.toString(16)}`]);
    if (image.signed !== null) rows.push(['Signed', image.signed ? 'yes' : 'no']);
  }
  if (sec?.secureBoot && image?.signed === false) {
    errors.push('Secure boot is on for this RP2350 and this image is not signed, so it would never boot. Use a signed release.');
  } else if (sec?.secureBoot && image?.signed) {
    warnings.push(
      `Secure boot is on (key slot ${sec.validKeys.join(', ') || 'unknown'}). The image only boots if it was signed with that key. Official pico-fido releases are signed with the PicoKeys key.`
    );
  }
  return { rows, errors, warnings, address: null, image };
}

export function Flasher() {
  const { lines, log, clear } = useLog();
  const boards = useBoards(log);
  const [target, setTarget] = useState<TargetId>('esp32-s3');
  const kind = TARGETS.find((t) => t.id === target)!.kind;

  const [source, setSource] = useState(FIRMWARE_SOURCES[0].repo);
  const [releases, setReleases] = useState<GithubRelease[] | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [assetKey, setAssetKey] = useState('');
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [eraseAll, setEraseAll] = useState(false);
  const [flashDone, setFlashDone] = useState(false);
  const [esp, setEsp] = useState<EspSession | null>(null);
  const espRef = useRef<EspSession | null>(null);
  useEffect(() => {
    espRef.current = esp;
  }, [esp]);

  const [rp, setRp] = useState<RpSession | null>(null);
  const rpRef = useRef<RpSession | null>(null);
  useEffect(() => {
    rpRef.current = rp;
  }, [rp]);

  const caps = useBrowserCaps();

  useEffect(() => {
    if (!caps.usb) return;
    const onDisconnect = (e: USBConnectionEvent) => {
      if (rpRef.current && e.device === rpRef.current.pb.device) setRp(null);
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => {
      navigator.usb.removeEventListener('disconnect', onDisconnect);
      void rpRef.current?.pb.close();
    };
  }, [caps.usb]);

  useEffect(() => {
    let alive = true;
    // Reset the listing when the source changes, then load it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReleases(null);
    setReleaseError(null);
    fetchReleases(source)
      .then((r) => alive && setReleases(r))
      .catch((e: Error) => alive && setReleaseError(e.message));
    return () => {
      alive = false;
    };
  }, [source]);

  useEffect(
    () => () => {
      void espRef.current?.transport.disconnect().catch(() => {});
    },
    []
  );

  const assets = useMemo(() => matchAssets(releases, target), [releases, target]);
  const assetId = (a: Asset) => `${a.release}/${a.name}`;

  /* ---------------- Firmware selection ---------------- */

  const loadAsset = async (key: string) => {
    const a = assets.find((x) => assetId(x) === key);
    if (!a) return;
    setFirmware(null);
    setDownload(0);
    log('info', `Downloading ${a.name} (${a.release})`);
    try {
      const bytes = await downloadFirmware(source, a.release, a.name, (d, t) => setDownload(t ? (d / t) * 100 : null));
      const src = FIRMWARE_SOURCES.find((s) => s.repo === source);
      setFirmware({ name: a.name, bytes, origin: `${src?.name ?? source} ${a.release}`, picoKeysSigned: !!src?.picoKeysSigned });
      log('ok', `Downloaded ${a.name}, ${formatBytes(bytes.length)}, MD5 ${md5Hex(bytes)}`);
    } catch (e) {
      log('error', (e as Error).message);
    } finally {
      setDownload(null);
    }
  };

  const loadLocal = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFirmware({ name: file.name, bytes, origin: 'local file', picoKeysSigned: false });
    log('info', `Loaded local file ${file.name}, ${formatBytes(bytes.length)}, MD5 ${md5Hex(bytes)}`);
  };

  const check = useMemo(() => {
    if (!firmware) return null;
    if (kind === 'esp') {
      const info = inspectEspImage(firmware.bytes);
      const plan = planEspFlash(info, esp?.chip ?? TARGETS.find((t) => t.id === target)!.name);
      return {
        rows: info
          ? ([
              ['Built for', info.chip],
              ['Flash mode', info.flashMode],
              ['Flash size', info.flashSize],
              ['Size', formatBytes(info.size)],
            ] as [string, string][])
          : [],
        ...plan,
        image: null,
      };
    }
    return uf2Check(firmware.bytes, target === 'rp2040' ? 'RP2040' : 'RP2350', rp?.security ?? null);
  }, [firmware, kind, esp, target, rp]);

  /* ---------------- ESP32 ---------------- */

  const espConnect = async () => {
    if (!caps.serial) return;
    setBusy(true);
    let port: SerialPort | null = null;
    let transport: Transport | null = null;
    try {
      port = await navigator.serial.requestPort({ filters: SERIAL_FILTERS });
      const { ESPLoader, Transport: EspTransport } = await import('esptool-js');
      transport = new EspTransport(port, false);
      let pending = '';
      const terminal = {
        clean: () => {},
        write: (s: string) => {
          pending += s;
        },
        writeLine: (s: string) => {
          const line = (pending + s).trim();
          pending = '';
          if (line) log('info', line);
        },
      };
      const loader = new ESPLoader({ transport, baudrate: 921600, romBaudrate: 115200, terminal });
      log('info', 'Connecting to the ESP32 bootloader');
      const desc = await loader.main();
      const features = await loader.chip.getChipFeatures(loader).catch(() => [] as string[]);
      const mac = await loader.chip.readMac(loader).catch(() => '');
      const flashSize = (await loader.detectFlashSize().catch(() => undefined)) ?? null;
      setEsp({ loader, transport, chip: desc, features, mac, flashSize });
      log('ok', `Connected: ${desc}`);
      const chip = normaliseChip(desc);
      const want = TARGETS.find((t) => t.id === target)!.name;
      if (chip && chip !== want && (chip === 'ESP32-S3' || chip === 'ESP32-S2')) {
        setTarget(chip === 'ESP32-S3' ? 'esp32-s3' : 'esp32-s2');
        log('info', `Switched target to ${chip} to match the connected chip.`);
      }
    } catch (e) {
      const err = e as Error;
      // Always release the port, or every retry fails with "port already open".
      if (transport) await transport.disconnect().catch(() => {});
      else if (port) await port.close().catch(() => {});
      if (err.name === 'NotFoundError') {
        log('info', 'No port selected. If the list was empty, the board is not in bootloader mode (see the tip above).');
      } else if (err.name === 'InvalidStateError' || /already open|failed to open/i.test(err.message)) {
        log('error', 'The port is busy. Close Arduino IDE, idf.py monitor, PuTTY or another Keyforge tab, then replug the board.');
      } else {
        log('error', `${err.message}. Put the board in bootloader mode (hold BOOT while plugging in) and try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const espDisconnect = async () => {
    await esp?.transport.disconnect().catch(() => {});
    setEsp(null);
    log('info', 'Serial port closed.');
  };

  const espFlash = async () => {
    if (!esp || !firmware || !check || check.errors.length) return;
    setBusy(true);
    setFlashDone(false);
    setProgress(0);
    try {
      log('wait', eraseAll ? 'Erasing the whole flash, then writing. Do not unplug.' : 'Writing firmware. Do not unplug.');
      await esp.loader.writeFlash({
        fileArray: [{ data: firmware.bytes, address: 0x0 }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll,
        compress: true,
        reportProgress: (_i, written, total) => setProgress((written / total) * 100),
        calculateMD5Hash: md5Hex,
      });
      log('ok', 'Write verified by MD5. Restarting the board.');
      await esp.loader.after('hard_reset');
      await esp.transport.disconnect().catch(() => {});
      setEsp(null);
      setFlashDone(true);
      log(
        'ok',
        'Done. The bootloader port closes and the board should come back as a Pico key in Board status. If not, press RESET.'
      );
      setTimeout(() => void boards.scan(), 2500);
    } catch (e) {
      log('error', `Flash failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /* ---------------- RP2040 / RP2350 ---------------- */

  const rpConnect = async () => {
    if (!caps.usb) return;
    setBusy(true);
    const pb = await Picoboot.request().catch((e: Error) => {
      if (e.name === 'NotFoundError') {
        log('info', 'No board selected. If the list was empty, the board is not in BOOTSEL mode (see the tip in step 1).');
      } else {
        log('error', e.message);
      }
      return null;
    });
    if (!pb) {
      setBusy(false);
      return;
    }
    const security = pb.chip === 'RP2350' ? await readSecurity(pb) : null;
    setRp({ pb, security });
    const sb = security ? ` Secure boot ${security.secureBoot ? 'ON' : 'off'}.` : '';
    log('ok', `Connected: ${pb.label}.${sb}`);
    const t: TargetId = pb.chip === 'RP2040' ? 'rp2040' : 'rp2350';
    if (t !== target) {
      setTarget(t);
      setFirmware(null);
      setAssetKey('');
      log('info', `Switched target to ${pb.chip} to match the connected board. Pick the firmware again.`);
    }
    setBusy(false);
  };

  const readSecurity = (pb: Picoboot) =>
    pb
      .readOtpRaw(OTP_SECURITY_ROW, OTP_SECURITY_ROWS)
      .then(decodeRpSecurity)
      .catch((e: Error) => {
        log('info', `Could not read secure boot state from OTP: ${e.message}`);
        return null;
      });

  const rpDisconnect = async () => {
    await rp?.pb.close();
    setRp(null);
    log('info', 'Board released.');
  };

  const rpFlash = async () => {
    if (!rp || !firmware || !check?.image || check.errors.length) return;
    const { pb } = rp;
    const { sectors } = check.image;
    setBusy(true);
    setFlashDone(false);
    setProgress(0);
    try {
      log('wait', `Writing ${sectors.length} sectors (${formatBytes(check.image.bytes)}). Do not unplug.`);
      await pb.exclusive(1);
      await pb.exitXip();
      // Erase, write and read back one 4 KiB sector at a time, so a failure names the exact address.
      for (let i = 0; i < sectors.length; i++) {
        const s = sectors[i];
        await pb.erase(s.addr, s.data.length);
        await pb.write(s.addr, s.data);
        const back = await pb.read(s.addr, s.data.length);
        if (back.some((b, j) => b !== s.data[j])) throw new Error(`Verify failed at 0x${s.addr.toString(16)}. The flash chip may be faulty.`);
        setProgress(((i + 1) / sectors.length) * 100);
      }
      log('ok', 'Written and verified byte for byte. Restarting the board.');
      await pb.reboot();
      await pb.close();
      setRp(null);
      setFlashDone(true);
      log('ok', 'Done. The board left BOOTSEL and should come back as a Pico key in Board status.');
      setTimeout(() => void boards.scan(), 2500);
    } catch (e) {
      log('error', `Flash failed: ${(e as Error).message}`);
      await pb.exclusive(0).catch(() => {});
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const rpCopy = async () => {
    if (!firmware || !check || check.errors.length) return;
    const picker = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
    if (!picker) return;
    let dir: FsDirHandle;
    try {
      dir = await picker({ mode: 'readwrite' });
    } catch {
      return;
    }
    setBusy(true);
    try {
      let info = '';
      try {
        info = await (await (await dir.getFileHandle('INFO_UF2.TXT')).getFile()).text();
      } catch {
        throw new Error(`"${dir.name}" is not a UF2 boot drive (no INFO_UF2.TXT). Pick the RPI-RP2 or RP2350 drive.`);
      }
      const driveChip = bootDriveChip(info);
      log('info', `Boot drive ${dir.name}: ${driveChip ?? 'unknown chip'}`);
      const plan = planUf2Copy(parseUf2(firmware.bytes), driveChip);
      if (plan.errors.length) throw new Error(plan.errors.join(' '));
      log('wait', `Copying ${firmware.name} to ${dir.name}. The board restarts by itself when done.`);
      const w = await (await dir.getFileHandle(firmware.name, { create: true })).createWritable();
      await w.write(firmware.bytes as BufferSource);
      try {
        await w.close();
      } catch {
        // The drive often disappears the moment the last block lands.
      }
      log('ok', 'Copied. Watch Board status: the drive disappears and a Pico key should appear within a few seconds.');
      setTimeout(() => void boards.scan(), 3000);
    } catch (e) {
      log('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveUf2 = () => {
    if (!firmware) return;
    const url = URL.createObjectURL(new Blob([firmware.bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: firmware.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const blocked = !firmware || !check || check.errors.length > 0 || busy;
  const whyBlocked = busy
    ? null
    : download !== null
      ? 'Downloading firmware...'
      : !firmware
        ? 'Choose a release file or a local file in step 2.'
        : check?.errors.length
          ? 'The selected file does not match this chip. See step 2.'
          : kind === 'esp' && !esp
            ? 'Connect the ESP32 first.'
            : kind === 'uf2' && !rp
              ? 'Connect the board in BOOTSEL mode first.'
              : kind === 'uf2' && !check?.image
                ? 'This file cannot be flashed over USB. Use Copy to boot drive.'
                : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <div className="space-y-5">
        <Panel title="1. Choose your chip">
          <div role="radiogroup" aria-label="Target chip" className="grid gap-2 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <label
                key={t.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-[10px] border px-4 py-3 transition-colors',
                  target === t.id ? 'border-accent-line bg-accent-soft' : 'border-line bg-raised hover:border-line-strong'
                )}
              >
                <input
                  type="radio"
                  name="target"
                  value={t.id}
                  checked={target === t.id}
                  onChange={() => {
                    setTarget(t.id);
                    setFirmware(null);
                    setAssetKey('');
                  }}
                  className="sr-only"
                />
                <Cpu size={20} weight="duotone" className={target === t.id ? 'text-accent' : 'text-muted'} />
                <span>
                  <span className="block font-mono text-sm font-semibold">{t.name.split(' (')[0]}</span>
                  <span className="text-xs text-muted">{t.kind === 'esp' ? 'Flash over Web Serial' : 'Flash over WebUSB'}</span>
                </span>
              </label>
            ))}
          </div>
          <Help className="mt-3">
            {kind === 'esp' ? (
              <>
                To enter the bootloader, hold <Kbd>BOOT</Kbd> while plugging the board in (or hold <Kbd>BOOT</Kbd>, tap{' '}
                <Kbd>RESET</Kbd>, release <Kbd>BOOT</Kbd>).
              </>
            ) : (
              <>
                Hold <Kbd>BOOTSEL</Kbd> while plugging the board in. A drive called RPI-RP2 (RP2040) or RP2350 appears.
              </>
            )}
          </Help>
        </Panel>

        <Panel title="2. Pick firmware">
          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <div>
              <Label htmlFor="source">Source</Label>
              <select id="source" className="field-input" value={source} onChange={(e) => setSource(e.target.value)}>
                {FIRMWARE_SOURCES.map((s) => (
                  <option key={s.repo} value={s.repo}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="asset">Release file</Label>
              <div className="flex gap-2">
                <select
                  id="asset"
                  className="field-input"
                  value={assetKey}
                  onChange={(e) => {
                    setAssetKey(e.target.value);
                    void loadAsset(e.target.value);
                  }}
                  disabled={!releases || assets.length === 0}
                >
                  <option value="">
                    {releaseError ? 'Could not load releases' : !releases ? 'Loading releases' : assets.length ? 'Choose a file' : 'No files for this chip'}
                  </option>
                  {assets.map((a) => (
                    <option key={assetId(a)} value={assetId(a)}>
                      {a.name} ({a.release}
                      {a.prerelease ? ', nightly' : ''})
                    </option>
                  ))}
                </select>
                <Button onClick={() => void loadAsset(assetKey)} disabled={!assetKey || download !== null} aria-label="Download selected file again" title="Download again">
                  <DownloadSimple size={16} weight="bold" />
                </Button>
              </div>
            </div>
          </div>
          {releaseError && <Notice tone="warn" className="mt-3" title="Release list unavailable">{releaseError}</Notice>}
          {releases && assets.length === 0 && source !== 'polhenarejos/pico-fido' && (
            <Help className="mt-3">
              No release for this chip from this source yet.{' '}
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setSource('polhenarejos/pico-fido')}>
                Use the official pico-fido release
              </button>
              .
            </Help>
          )}
          {download !== null && <div className="mt-4"><Progress value={download} label="Downloading" /></div>}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <label className={cn('cursor-pointer', 'inline-flex items-center gap-2 text-sm text-muted hover:text-fg')}>
              <FileArrowUp size={18} weight="duotone" />
              <span>Or use a local {kind === 'esp' ? '.bin' : '.uf2'} file</span>
              <input
                type="file"
                accept={kind === 'esp' ? '.bin,application/octet-stream' : '.uf2'}
                className="sr-only"
                onChange={(e) => {
                  void loadLocal(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {firmware && check && (
            <div className="mt-4 space-y-3 rounded-[10px] border border-line bg-sunken p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm break-all">{firmware.name}</p>
                <Pill tone={check.errors.length ? 'danger' : 'ok'}>{check.errors.length ? 'Will not flash' : 'Checked'}</Pill>
              </div>
              <p className="text-xs text-faint">From {firmware.origin}</p>
              {check.rows.length > 0 && <KeyValue rows={check.rows} />}
              {!firmware.picoKeysSigned && (
                <Notice tone="neutral">
                  Not signed with the PicoKeys release key. It runs normally, but do not enable secure boot in Configure afterwards: that
                  burns the PicoKeys key, and this build would stop booting.
                </Notice>
              )}
              {check.errors.map((e) => (
                <Notice key={e} tone="danger">{e}</Notice>
              ))}
              {check.warnings.map((w) => (
                <Notice key={w} tone="warn">{w}</Notice>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="3. Flash">
          {kind === 'esp' ? (
            caps.ready && !caps.serial ? (
              <Notice tone="danger" title="Web Serial is not available">
                Use Chrome, Edge or another Chromium browser on desktop.
              </Notice>
            ) : (
              <div className="space-y-4">
                {!esp ? (
                  <Button variant="secondary" onClick={espConnect} disabled={busy}>
                    <PlugsConnected size={16} weight="bold" /> Connect ESP32
                  </Button>
                ) : (
                  <div className="space-y-3 rounded-[10px] border border-accent-line bg-accent-soft p-4">
                    <KeyValue
                      rows={[
                        ['Chip', esp.chip],
                        ['Flash', esp.flashSize ?? 'unknown'],
                        ['Memory', esp.features.filter((f) => /flash|psram/i.test(f)).join(', ') || 'no embedded PSRAM reported'],
                        ['MAC', esp.mac || 'n/a'],
                      ]}
                    />
                    <Button size="sm" variant="ghost" onClick={espDisconnect} disabled={busy}>
                      Disconnect
                    </Button>
                  </div>
                )}
                <Check
                  label="Erase the entire flash first (removes all passkeys and settings on this board)"
                  checked={eraseAll}
                  onChange={(e) => setEraseAll(e.target.checked)}
                  disabled={busy}
                />
                {progress !== null && <Progress value={progress} label="Writing" />}
                {flashDone && (
                  <Notice tone="ok" title="Flash complete">
                    Firmware written and verified. The board restarted. When Board status shows a Pico key, open Configure.
                  </Notice>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="lg" onClick={espFlash} disabled={!esp || blocked}>
                    <Lightning size={18} weight="fill" /> Flash firmware
                  </Button>
                  {whyBlocked && <span className="text-[13px] text-muted">{whyBlocked}</span>}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {caps.ready && !caps.usb ? (
                <Notice tone="danger" title="WebUSB is not available">
                  Use Chrome, Edge or another Chromium browser on desktop, or save the file and copy it to the boot drive.
                </Notice>
              ) : !rp ? (
                <Button variant="secondary" onClick={rpConnect} disabled={busy}>
                  <PlugsConnected size={16} weight="bold" /> Connect board
                </Button>
              ) : (
                <div className="space-y-3 rounded-[10px] border border-accent-line bg-accent-soft p-4">
                  <KeyValue
                    rows={[
                      ['Chip', rp.pb.chip],
                      ['Serial', rp.pb.device.serialNumber || 'n/a'],
                      ...(rp.pb.chip === 'RP2350'
                        ? ([
                            [
                              'Secure boot',
                              rp.security
                                ? rp.security.secureBoot
                                  ? `on, key slot ${rp.security.validKeys.join(', ') || 'none valid'}`
                                  : 'off (any firmware boots)'
                                : 'unknown',
                            ],
                          ] as [string, string][])
                        : []),
                    ]}
                  />
                  <Button size="sm" variant="ghost" onClick={rpDisconnect} disabled={busy}>
                    Disconnect
                  </Button>
                </div>
              )}
              <Help>
                Only the sectors in the file are rewritten, so passkeys stored on the key survive. Secure boot is turned on or off in
                Configure after flashing, never here.
              </Help>
              {progress !== null && <Progress value={progress} label="Writing and verifying" />}
              {flashDone && (
                <Notice tone="ok" title="Flash complete">
                  Firmware written and verified. The board restarted. When Board status shows a Pico key, open Configure.
                </Notice>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" size="lg" onClick={rpFlash} disabled={!rp || blocked || !check?.image}>
                  <Lightning size={18} weight="fill" /> Flash firmware
                </Button>
                {whyBlocked && <span className="text-[13px] text-muted">{whyBlocked}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm text-muted">
                <span>Other ways:</span>
                {caps.dirPicker && (
                  <Button variant="ghost" size="sm" onClick={rpCopy} disabled={blocked}>
                    <FolderOpen size={16} weight="duotone" /> Copy to boot drive
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={saveUf2} disabled={!firmware}>
                  Save .uf2 to disk
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-5 lg:sticky lg:top-24">
        <BoardStatusPanel boards={boards} />
        <Panel title="Activity">
          <LogView lines={lines} onClear={clear} emptyText="Choose a chip and firmware to begin." height="h-80" />
        </Panel>
      </div>
    </div>
  );
}
