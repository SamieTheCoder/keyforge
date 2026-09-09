// SPDX-License-Identifier: MIT
//
// PICOBOOT over WebUSB: the RP2040 / RP2350 bootrom's vendor interface.
// Command layout, endpoint sequencing and the interface-reset dance follow
// picoflash by Piers Finlayson (https://github.com/piersfinlayson/picoflash),
// MIT License, Copyright (c) 2025 Piers Finlayson. See THIRD_PARTY_NOTICES.md.
//
// Only read-side OTP access is implemented. Nothing here can burn OTP.

export const RP_VID = 0x2e8a;
export const PICOBOOT_FILTERS: USBDeviceFilter[] = [
  { vendorId: RP_VID, productId: 0x0003 }, // RP2040 BOOTSEL
  { vendorId: RP_VID, productId: 0x000f }, // RP2350 BOOTSEL
];

export type RpChip = 'RP2040' | 'RP2350';

export const FLASH_START = 0x10000000;
export const FLASH_END = 0x11000000; // 16 MiB XIP window
export const SECTOR = 0x1000;
export const PAGE = 0x100;

const MAGIC = 0x431fd10b;
const REQ_RESET = 0x41;
const REQ_STATUS = 0x42;

export const CMD = {
  EXCLUSIVE_ACCESS: 0x01,
  REBOOT: 0x02,
  FLASH_ERASE: 0x03,
  WRITE: 0x05,
  EXIT_XIP: 0x06,
  REBOOT2: 0x0a,
  READ: 0x84,
  OTP_READ: 0x8c,
} as const;

const STATUS_NAMES = [
  'OK',
  'unknown command',
  'invalid command length',
  'invalid transfer length',
  'invalid address',
  'bad alignment',
  'interleaved write',
  'rebooting',
  'unknown error',
  'invalid state',
  'not permitted',
  'invalid argument',
  'buffer too small',
  'precondition not met',
  'modified data',
  'invalid data',
  'not found',
  'unsupported modification',
];

export class PicobootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PicobootError';
  }
}

/** 32-byte PICOBOOT command packet (pure, unit tested). */
export function buildCommand(token: number, cmdId: number, cmdSize: number, transferLen: number, args?: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const v = new DataView(out.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, token >>> 0, true);
  v.setUint8(8, cmdId);
  v.setUint8(9, cmdSize);
  v.setUint32(12, transferLen >>> 0, true);
  if (args) out.set(args.subarray(0, 16), 16);
  return out;
}

function words(...w: number[]): Uint8Array {
  const a = new Uint8Array(16);
  const v = new DataView(a.buffer);
  w.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true));
  return a;
}

export const chipForPid = (pid: number): RpChip | null => (pid === 0x0003 ? 'RP2040' : pid === 0x000f ? 'RP2350' : null);

export class Picoboot {
  private token = 1;
  private ifNum = -1;
  private inEp = 0;
  private outEp = 0;
  private packet = 64;

  constructor(
    readonly device: USBDevice,
    readonly chip: RpChip
  ) {}

  static async request(): Promise<Picoboot> {
    const device = await navigator.usb.requestDevice({ filters: PICOBOOT_FILTERS });
    const chip = chipForPid(device.productId);
    if (!chip) throw new PicobootError('That is not an RP2040 or RP2350 in BOOTSEL mode.');
    try {
      const p = new Picoboot(device, chip);
      await p.open();
      return p;
    } catch (e) {
      await device.close().catch(() => {});
      throw e;
    }
  }

  get label() {
    return `${this.chip} BOOTSEL${this.device.serialNumber ? ` (${this.device.serialNumber})` : ''}`;
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const ifaces = d.configuration!.interfaces;
    // The bootrom puts PICOBOOT on interface 1 when mass storage is enabled, else 0.
    for (const iface of ifaces) {
      const alt = iface.alternates.find((a) => a.interfaceClass === 0xff && a.interfaceSubclass === 0x00);
      if (!alt) continue;
      const bin = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      const bout = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      if (!bin || !bout) continue;
      this.ifNum = iface.interfaceNumber;
      this.inEp = bin.endpointNumber;
      this.outEp = bout.endpointNumber;
      this.packet = bin.packetSize || 64;
      break;
    }
    if (this.ifNum < 0) throw new PicobootError('The board has no PICOBOOT interface. Is it in BOOTSEL mode?');
    try {
      await d.claimInterface(this.ifNum);
    } catch (e) {
      throw new PicobootError(
        `Could not open the PICOBOOT interface (${(e as Error).message}). ` +
          (this.chip === 'RP2040'
            ? 'On Windows the RP2040 bootrom needs the WinUSB driver for "RP2 Boot (Interface 1)" (install it once with Zadig), or use Copy to boot drive instead.'
            : 'Close picotool or any other tab using the board, then replug it in BOOTSEL mode.')
      );
    }
    await this.resetInterface();
  }

  async close() {
    try {
      if (this.ifNum >= 0) await this.device.releaseInterface(this.ifNum);
    } catch {
      /* already gone */
    }
    try {
      await this.device.close();
    } catch {
      /* already gone */
    }
  }

  private async resetInterface() {
    await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'interface', request: REQ_RESET, value: 0, index: this.ifNum });
  }

  private async status(): Promise<string> {
    try {
      const r = await this.device.controlTransferIn(
        { requestType: 'vendor', recipient: 'interface', request: REQ_STATUS, value: 0, index: this.ifNum },
        16
      );
      if (r.status !== 'ok' || !r.data) return 'no status';
      const code = r.data.getUint32(4, true);
      return STATUS_NAMES[code] ?? `status ${code}`;
    } catch {
      return 'no status';
    }
  }

  /** Command, optional data phase, then the zero-length ack in the opposite direction. */
  private async send(name: string, cmdId: number, cmdSize: number, args: Uint8Array, data?: Uint8Array, readLen = 0): Promise<Uint8Array> {
    const isIn = (cmdId & 0x80) !== 0;
    const transferLen = isIn ? readLen : (data?.length ?? 0);
    const d = this.device;
    try {
      const w = await d.transferOut(this.outEp, buildCommand(this.token++, cmdId, cmdSize, transferLen, args) as BufferSource);
      if (w.status !== 'ok') throw new Error(w.status);
      let result: Uint8Array = new Uint8Array(0);
      if (isIn && readLen) {
        const len = Math.ceil(readLen / this.packet) * this.packet;
        const r = await d.transferIn(this.inEp, len);
        if (r.status !== 'ok' || !r.data) throw new Error(r.status ?? 'no data');
        result = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice(0, readLen);
        if (result.length < readLen) throw new Error(`short read (${result.length} of ${readLen} bytes)`);
      } else if (!isIn && data?.length) {
        const r = await d.transferOut(this.outEp, data as BufferSource);
        if (r.status !== 'ok' || r.bytesWritten !== data.length) throw new Error(r.status);
      }
      // Ack in the opposite direction. picoflash sends one byte for the IN ack; mirror that.
      if (isIn) await d.transferOut(this.outEp, Uint8Array.of(0) as BufferSource);
      else await d.transferIn(this.inEp, 1);
      return result;
    } catch (e) {
      const why = await this.status();
      await this.resetInterface().catch(() => {});
      throw new PicobootError(`${name} failed: ${why} (${(e as Error).message})`);
    }
  }

  /** 1 = exclusive (the boot drive goes read-only while we write). */
  exclusive(mode: 0 | 1 | 2) {
    return this.send('Exclusive access', CMD.EXCLUSIVE_ACCESS, 1, Uint8Array.of(mode, ...new Uint8Array(15)));
  }

  exitXip() {
    return this.send('Exit XIP', CMD.EXIT_XIP, 0, new Uint8Array(16));
  }

  erase(addr: number, size: number) {
    if (addr % SECTOR || size % SECTOR) throw new PicobootError('Erase must be 4 KiB aligned');
    return this.send(`Erase 0x${addr.toString(16)}`, CMD.FLASH_ERASE, 8, words(addr, size));
  }

  write(addr: number, data: Uint8Array) {
    if (addr % PAGE) throw new PicobootError('Write must be 256-byte aligned');
    return this.send(`Write 0x${addr.toString(16)}`, CMD.WRITE, 8, words(addr, data.length), data);
  }

  read(addr: number, size: number) {
    return this.send(`Read 0x${addr.toString(16)}`, CMD.READ, 8, words(addr, size), undefined, size);
  }

  /** Raw (non-ECC) OTP rows, 4 bytes each. RP2350 only. */
  readOtpRaw(row: number, count: number) {
    if (this.chip !== 'RP2350') throw new PicobootError('OTP is RP2350 only');
    const args = new Uint8Array(16);
    const v = new DataView(args.buffer);
    v.setUint16(0, row, true);
    v.setUint16(2, count, true);
    v.setUint8(4, 0);
    return this.send('Read OTP', CMD.OTP_READ, 5, args, undefined, count * 4);
  }

  /** Boot the flashed firmware. The device drops off the bus, so the ack may never arrive. */
  async reboot(delayMs = 200) {
    const p =
      this.chip === 'RP2040'
        ? this.send('Reboot', CMD.REBOOT, 12, words(0, 0x20042000, delayMs))
        : this.send('Reboot', CMD.REBOOT2, 16, words(0, delayMs, 0, 0));
    await p.catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* RP2350 secure boot state from OTP (read only)                       */
/* ------------------------------------------------------------------ */

/** CRIT1 (8 copies) then BOOT_FLAGS0 (3) and BOOT_FLAGS1 (3): rows 0x40 to 0x4d. */
export const OTP_SECURITY_ROW = 0x40;
export const OTP_SECURITY_ROWS = 14;

export interface RpSecurity {
  secureBoot: boolean;
  debugDisabled: boolean;
  validKeys: number[];
  revokedKeys: number[];
}

/**
 * Decode the raw rows. Per the RP2350 datasheet, a CRIT1 bit counts as set
 * when at least 3 of its 8 copies have it, and BOOT_FLAGS1 uses a 2-of-3 vote.
 */
export function decodeRpSecurity(raw: Uint8Array): RpSecurity {
  if (raw.length < OTP_SECURITY_ROWS * 4) throw new Error('OTP read too short');
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const row = (i: number) => v.getUint32(i * 4, true) & 0xffffff;
  const vote = (first: number, copies: number, need: number) => {
    let out = 0;
    for (let bit = 0; bit < 24; bit++) {
      let n = 0;
      for (let c = 0; c < copies; c++) if (row(first + c) & (1 << bit)) n++;
      if (n >= need) out |= 1 << bit;
    }
    return out;
  };
  const crit1 = vote(0, 8, 3);
  const flags1 = vote(0x0b, 3, 2);
  const slots = (mask: number) => [0, 1, 2, 3].filter((k) => mask & (1 << k));
  return {
    secureBoot: !!(crit1 & 0x1),
    debugDisabled: !!(crit1 & 0x4),
    validKeys: slots(flags1 & 0xf),
    revokedKeys: slots((flags1 >> 8) & 0xf),
  };
}
