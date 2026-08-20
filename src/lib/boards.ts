// SPDX-License-Identifier: AGPL-3.0-only
//
// Board detection and serial-monitor helpers. Pure, unit tested.

export const ESPRESSIF_VID = 0x303a;
/** ESP32-S3/C3/C6 built-in USB-Serial/JTAG (ROM + bootloader). */
export const ESP_USB_JTAG_PID = 0x1001;
/** ESP32-S2/S3 ROM USB-OTG download mode. */
export const ESP_ROM_OTG_PID = 0x0002;
/** Raspberry Pi RP2040/RP2350 BOOTSEL (mass storage + PICOBOOT). */
export const RPI_VID = 0x2e8a;
export const RP2040_BOOT_PID = 0x0003;
export const RP2350_BOOT_PID = 0x000f;

export type BoardKind = 'pico-key' | 'esp-bootloader' | 'rp-bootsel' | 'other';

export interface BoardItem {
  kind: BoardKind;
  key: string;
  label: string;
  usbId: string;
  via: 'USB' | 'Serial' | 'USB + Serial';
}

const id = (vid?: number, pid?: number) =>
  `${(vid ?? 0).toString(16).padStart(4, '0')}:${(pid ?? 0)
    .toString(16)
    .padStart(4, '0')}`.toUpperCase();

const isEspBoot = (vid?: number, pid?: number) =>
  vid === ESPRESSIF_VID && (pid === ESP_USB_JTAG_PID || pid === ESP_ROM_OTG_PID);

export function classifyUsb(d: {
  vendorId: number;
  productId: number;
  productName?: string;
  hasWebCcid?: boolean;
}): BoardItem {
  const usbId = id(d.vendorId, d.productId);
  // Bootloaders first: their IDs are fixed and can never be a running key.
  if (isEspBoot(d.vendorId, d.productId)) {
    return { kind: 'esp-bootloader', key: `esp:${usbId}`, label: 'ESP32 bootloader', usbId, via: 'USB' };
  }
  if (d.hasWebCcid) {
    return { kind: 'pico-key', key: `pico:${usbId}`, label: d.productName || 'Pico key', usbId, via: 'USB' };
  }
  if (d.vendorId === RPI_VID && (d.productId === RP2040_BOOT_PID || d.productId === RP2350_BOOT_PID)) {
    const chip = d.productId === RP2040_BOOT_PID ? 'RP2040' : 'RP2350';
    return { kind: 'rp-bootsel', key: `rp:${usbId}`, label: `${chip} BOOTSEL`, usbId, via: 'USB' };
  }
  return { kind: 'other', key: `other:${usbId}`, label: d.productName || 'USB device', usbId, via: 'USB' };
}

export function classifySerial(info: { usbVendorId?: number; usbProductId?: number } = {}): BoardItem {
  if (info.usbVendorId == null) {
    return { kind: 'other', key: 'serial:unknown', label: 'Serial port', usbId: 'n/a', via: 'Serial' };
  }
  const usbId = id(info.usbVendorId, info.usbProductId);
  if (isEspBoot(info.usbVendorId, info.usbProductId)) {
    return { kind: 'esp-bootloader', key: `esp:${usbId}`, label: 'ESP32 bootloader', usbId, via: 'Serial' };
  }
  return { kind: 'other', key: `serial:${usbId}`, label: 'Serial adapter', usbId, via: 'Serial' };
}

export function dedupeBoards(items: BoardItem[]): BoardItem[] {
  const map = new Map<string, BoardItem>();
  for (const it of items) {
    const prev = map.get(it.key);
    map.set(it.key, prev ? { ...prev, via: prev.via === it.via ? prev.via : 'USB + Serial' } : it);
  }
  return [...map.values()];
}

export interface Verdict {
  level: 'ok' | 'warn' | 'idle';
  title: string;
  text: string;
}

export function boardVerdict(items: BoardItem[]): Verdict {
  const has = (k: BoardKind) => items.some((i) => i.kind === k);
  const boot = has('esp-bootloader') || has('rp-bootsel');
  if (has('pico-key') && boot) {
    return {
      level: 'warn',
      title: 'Two boards connected',
      text: 'A running key and a board in bootloader mode are both plugged in. Unplug one to avoid mixing them up.',
    };
  }
  if (has('pico-key')) {
    return { level: 'ok', title: 'Firmware is running', text: 'The board answers as a Pico key. The flash worked.' };
  }
  if (has('esp-bootloader')) {
    return {
      level: 'warn',
      title: 'ESP32 is in bootloader mode',
      text: 'Ready to flash. If you already flashed, press RESET (not BOOT). If it stays here, the flash did not take.',
    };
  }
  if (has('rp-bootsel')) {
    return {
      level: 'warn',
      title: 'RP board is in BOOTSEL mode',
      text: 'Ready to flash: copy a .uf2 to the RPI-RP2 / RP2350 drive. It restarts on its own when done.',
    };
  }
  return {
    level: 'idle',
    title: 'No board seen',
    text: 'Plug in the board and click Find board. Allow the device once so Keyforge can watch it.',
  };
}

export function describeTransition(
  prev: BoardItem[],
  next: BoardItem[]
): { level: 'ok' | 'warn' | 'info'; text: string } | null {
  const kinds = (xs: BoardItem[]) => new Set(xs.map((x) => x.kind));
  const a = kinds(prev);
  const b = kinds(next);
  const bootA = a.has('esp-bootloader') || a.has('rp-bootsel');
  const bootB = b.has('esp-bootloader') || b.has('rp-bootsel');
  if (bootA && !bootB && b.has('pico-key')) {
    return { level: 'ok', text: 'Bootloader closed and a Pico key appeared. The new firmware booted, so the flash succeeded.' };
  }
  if (!a.has('pico-key') && b.has('pico-key')) return { level: 'ok', text: 'Pico key connected. Firmware is running.' };
  if (a.has('pico-key') && !b.has('pico-key') && bootB) {
    return { level: 'warn', text: 'Pico key left and the board came back in bootloader mode.' };
  }
  if (!bootA && bootB) return { level: 'warn', text: 'Board appeared in bootloader mode.' };
  if (a.has('pico-key') && !b.has('pico-key')) return { level: 'info', text: 'Pico key unplugged.' };
  if (bootA && !bootB) {
    return { level: 'info', text: 'Bootloader closed. If the board was reset, wait a moment for the Pico key to appear.' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Serial text                                                         */
/* ------------------------------------------------------------------ */

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/** Splits streamed text into lines; handles \n, \r\n split across chunks, and lone \r. */
export class LineBuffer {
  private partial = '';

  push(text: string): string[] {
    const s = this.partial + text;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\n' && c !== '\r') continue;
      if (c === '\r' && i === s.length - 1) {
        this.partial = s.slice(start);
        return out;
      }
      out.push(s.slice(start, i));
      if (c === '\r' && s[i + 1] === '\n') i++;
      start = i + 1;
    }
    this.partial = s.slice(start);
    return out;
  }

  flush(): string {
    const p = this.partial.replace(/\r$/, '');
    this.partial = '';
    return p;
  }

  get pending(): boolean {
    return this.partial.length > 0;
  }
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function logLevel(line: string): LogLevel | null {
  const m = /^([EWIDV]) \(\d+\)/.exec(line);
  if (m) return ({ E: 'error', W: 'warn', I: 'info', D: 'debug', V: 'debug' } as const)[m[1] as 'E'];
  if (/Guru Meditation|abort\(\)|panic|Backtrace:/i.test(line)) return 'error';
  return null;
}

export interface Hint {
  level: 'error' | 'warn' | 'info';
  text: string;
}

export function bootHint(line: string): Hint | null {
  const l = line.toLowerCase();
  if (l.includes('waiting for download') || /boot:0x[0-9a-f]+ \(download/.test(l)) {
    return { level: 'warn', text: 'Board is in download mode (BOOT was held during reset). Press RESET alone to run the firmware.' };
  }
  if (l.includes('invalid header: 0xffffffff')) {
    return { level: 'error', text: 'Flash is empty at the boot address. Flash the firmware again (merged .bin at 0x0).' };
  }
  if (l.includes('invalid header') || l.includes('checksum failure') || l.includes('image hash failed')) {
    return { level: 'error', text: 'Firmware image is corrupt or written at the wrong address. Flash again.' };
  }
  if (l.includes('no bootable app partitions') || l.includes('ota data partition invalid')) {
    return { level: 'error', text: 'No bootable app found. Flash the full merged image, not only the app.' };
  }
  if (l.includes('secure boot check fail') || l.includes('signature verification failed')) {
    return { level: 'error', text: 'Secure boot rejected the image. Only firmware signed with the burned key will boot.' };
  }
  if (l.includes('psram') && (l.includes('fail') || l.includes('not found'))) {
    return { level: 'warn', text: 'PSRAM was not detected. Check that the firmware matches your module (for example N8R8 vs N8).' };
  }
  if (l.includes('brownout')) {
    return { level: 'warn', text: 'Brownout reset: the board is not getting enough power. Try another cable or port.' };
  }
  if (l.includes('guru meditation')) {
    return { level: 'error', text: 'Firmware crashed. Save the log and report it to the firmware project.' };
  }
  if (/^rst:0x[0-9a-f]+/.test(l) || l.startsWith('esp-rom:')) {
    return { level: 'info', text: 'Chip reset detected. Watching the boot messages.' };
  }
  return null;
}

export interface SignalStep {
  dtr: boolean;
  rts: boolean;
  wait: number;
}

/** DTR/RTS sequences matching esptool's reset strategies. */
export function resetSteps(mode: 'run' | 'download', { usbJtag }: { usbJtag: boolean }): SignalStep[] {
  if (mode === 'run') {
    return [
      { dtr: false, rts: true, wait: usbJtag ? 200 : 100 },
      { dtr: false, rts: false, wait: usbJtag ? 200 : 50 },
    ];
  }
  if (mode === 'download') {
    if (usbJtag) {
      return [
        { dtr: false, rts: false, wait: 100 },
        { dtr: true, rts: false, wait: 100 },
        { dtr: false, rts: true, wait: 100 },
        { dtr: false, rts: false, wait: 50 },
      ];
    }
    return [
      { dtr: false, rts: true, wait: 100 },
      { dtr: true, rts: false, wait: 50 },
      { dtr: false, rts: false, wait: 0 },
    ];
  }
  throw new Error(`Unknown reset mode: ${mode as string}`);
}
