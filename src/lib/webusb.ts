// SPDX-License-Identifier: AGPL-3.0-only
//
// WebUSB transport for the pico-keys "WebCCID" interface: a vendor-class
// (0xFF) interface with two bulk endpoints speaking plain CCID. Windows binds
// it to WinUSB through the MS OS 2.0 descriptor, so no driver, admin rights or
// PC/SC stack is needed. Browser-only (uses navigator.usb).

import {
  APDU,
  ApduError,
  CCID,
  buildCcid,
  ccidCommandStatus,
  concat,
  parseCcidHeader,
  parseFlashInfo,
  parsePhy,
  parseResponse,
  parseSecureBoot,
  parseSelect,
  serializePhy,
  toHex,
  type DeviceInfo,
  type PhyConfig,
} from './protocol';

const VENDOR_CLASS = 0xff;
const DEFAULT_TIMEOUT_MS = 8_000;
/** Writes that need the BOOT button (firmware waits up to 255 s). */
const PRESENCE_TIMEOUT_MS = 270_000;

export type TransportLog = (
  kind: 'tx' | 'rx' | 'info' | 'wait' | 'error',
  text: string
) => void;

export const isWebUsbAvailable = () =>
  typeof navigator !== 'undefined' && 'usb' in navigator;

export interface WebCcidInterface {
  interfaceNumber: number;
  alternateSetting: number;
  name: string | null;
  epIn: number;
  epOut: number;
  packetSize: number;
}

export function findWebCcidInterface(
  device: USBDevice
): WebCcidInterface | null {
  const config = device.configuration ?? device.configurations?.[0];
  if (!config) return null;
  for (const itf of config.interfaces) {
    for (const alt of itf.alternates) {
      // pico-fido WebCCID is class FF / subclass 00 / protocol 00. The ESP32
      // USB-Serial/JTAG debug interface is FF/FF/01 with the same two bulk
      // endpoints, so subclass and protocol must be checked too.
      if (
        alt.interfaceClass !== VENDOR_CLASS ||
        alt.interfaceSubclass !== 0 ||
        alt.interfaceProtocol !== 0 ||
        alt.endpoints.length !== 2
      ) {
        continue;
      }
      const bulkIn = alt.endpoints.find(
        (e) => e.type === 'bulk' && e.direction === 'in'
      );
      const bulkOut = alt.endpoints.find(
        (e) => e.type === 'bulk' && e.direction === 'out'
      );
      if (bulkIn && bulkOut) {
        return {
          interfaceNumber: itf.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          name: alt.interfaceName ?? null,
          epIn: bulkIn.endpointNumber,
          epOut: bulkOut.endpointNumber,
          packetSize: bulkIn.packetSize || 64,
        };
      }
    }
  }
  return null;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class CcidTransport {
  readonly device: USBDevice;
  private log: TransportLog;
  private itf: WebCcidInterface | null = null;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  closed = false;

  constructor(device: USBDevice, log: TransportLog = () => {}) {
    this.device = device;
    this.log = log;
  }

  get label(): string {
    const d = this.device;
    const id = `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId
      .toString(16)
      .padStart(4, '0')}`.toUpperCase();
    return `${d.productName || 'USB device'} (${id})`;
  }

  async open(): Promise<void> {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const itf = findWebCcidInterface(d);
    if (!itf) {
      throw new Error(
        'This device has no WebCCID interface. Make sure it runs Keyzforge firmware and that the WebCCID USB interface is enabled.'
      );
    }
    try {
      await d.claimInterface(itf.interfaceNumber);
    } catch (e) {
      throw new Error(
        `Could not claim interface ${itf.interfaceNumber} (${(e as Error).message}). Close other tabs or apps using the key, then replug it.`
      );
    }
    if (itf.alternateSetting !== 0) {
      await d.selectAlternateInterface(
        itf.interfaceNumber,
        itf.alternateSetting
      );
    }
    this.itf = itf;
    this.log(
      'info',
      `Claimed interface ${itf.interfaceNumber}${itf.name ? ` "${itf.name}"` : ''}`
    );
    const atr = await this.exchange(
      CCID.PC_TO_RDR_ICC_POWER_ON,
      new Uint8Array(0),
      DEFAULT_TIMEOUT_MS
    );
    this.log('info', `ATR ${toHex(atr)}`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.device.opened && this.itf) {
        await this.device
          .releaseInterface(this.itf.interfaceNumber)
          .catch(() => {});
      }
      if (this.device.opened) await this.device.close();
    } catch {
      /* already gone */
    }
  }

  /** Send one APDU, follow 61xx chains. Calls are serialized. */
  transmit(
    apdu: Uint8Array,
    {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      note,
    }: { timeoutMs?: number; note?: string } = {}
  ): Promise<{ data: Uint8Array; sw: number }> {
    const run = async () => {
      this.log('tx', `→ ${toHex(apdu)}${note ? `   (${note})` : ''}`);
      let resp = parseResponse(
        await this.exchange(CCID.PC_TO_RDR_XFR_BLOCK, apdu, timeoutMs)
      );
      let data = resp.data;
      while (resp.sw1 === 0x61) {
        resp = parseResponse(
          await this.exchange(
            CCID.PC_TO_RDR_XFR_BLOCK,
            APDU.getResponse(resp.sw2),
            timeoutMs
          )
        );
        data = concat(data, resp.data);
      }
      this.log(
        'rx',
        `← ${toHex(concat(data, Uint8Array.of(resp.sw1, resp.sw2)))}`
      );
      return { data, sw: resp.sw };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  private async exchange(
    type: number,
    payload: Uint8Array,
    timeoutMs: number
  ): Promise<Uint8Array> {
    if (this.closed || !this.itf) throw new Error('Device is closed');
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    await this.device.transferOut(
      this.itf.epOut,
      buildCcid(type, seq, payload) as BufferSource
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new TimeoutError(
            `No response from the key within ${Math.round(timeoutMs / 1000)} s`
          )
        );
        // A pending transferIn cannot be cancelled; closing is the only way out.
        void this.close();
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.readReply(seq), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readReply(seq: number): Promise<Uint8Array> {
    let notified = false;
    for (;;) {
      const msg = await this.readMessage();
      const h = parseCcidHeader(msg)!;
      if (h.seq !== seq) {
        this.log(
          'info',
          `Discarding stale CCID frame (seq ${h.seq}, expected ${seq})`
        );
        continue;
      }
      const status = ccidCommandStatus(h);
      if (status === 'time-extension') {
        if (!notified) {
          notified = true;
          this.log(
            'wait',
            'Key is busy. If the LED blinks yellow, press the BOOT button to confirm.'
          );
        }
        continue;
      }
      if (status === 'failed') {
        throw new Error(
          `CCID command failed (bStatus 0x${h.status.toString(16)}, bError 0x${h.error.toString(16)})`
        );
      }
      return msg.slice(CCID.HEADER_SIZE, h.totalLength);
    }
  }

  private async readMessage(): Promise<Uint8Array> {
    const itf = this.itf!;
    let buf: Uint8Array = new Uint8Array(0);
    for (;;) {
      const r = await this.device.transferIn(itf.epIn, itf.packetSize);
      if (r.status === 'stall') {
        await this.device.clearHalt('in', itf.epIn);
        continue;
      }
      if (r.status === 'babble') throw new Error('USB babble error');
      if (!r.data || r.data.byteLength === 0) continue;
      buf = concat(
        buf,
        new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)
      );
      const h = parseCcidHeader(buf);
      if (h && buf.length >= h.totalLength) return buf;
    }
  }
}

/** High-level rescue-applet session. */
export class RescueSession {
  readonly t: CcidTransport;
  info: DeviceInfo | null = null;

  constructor(transport: CcidTransport) {
    this.t = transport;
  }

  private async call(apdu: Uint8Array, context: string, timeoutMs?: number) {
    const r = await this.t.transmit(apdu, { note: context, timeoutMs });
    if (r.sw !== 0x9000) throw new ApduError(r.sw, context);
    return r.data;
  }

  async select() {
    this.info = parseSelect(
      await this.call(APDU.selectRescue(), 'Select rescue applet')
    );
    return this.info;
  }

  async readPhy() {
    const raw = await this.call(APDU.readPhy(), 'Read configuration');
    return { raw, ...parsePhy(raw) };
  }

  async readFlashInfo() {
    return parseFlashInfo(
      await this.call(APDU.readFlashInfo(), 'Read flash info')
    );
  }

  async readSecureBoot() {
    const r = await this.t.transmit(APDU.readSecureBoot(), {
      note: 'Read secure boot status',
    });
    if (r.sw !== 0x9000 || r.data.length < 3) return null;
    return parseSecureBoot(r.data);
  }

  /** Firmware replaces the whole record, so pass every field to keep. Needs a BOOT press. */
  async writePhy(config: PhyConfig) {
    const tlv = serializePhy(config);
    await this.call(
      APDU.writePhy(tlv),
      'Write configuration',
      PRESENCE_TIMEOUT_MS
    );
    return tlv;
  }

  /** IRREVERSIBLE: burns eFuses / OTP. Needs a BOOT press. */
  async enableSecureBoot(bootKey: number, lock: boolean) {
    await this.call(
      APDU.enableSecureBoot(bootKey, lock),
      lock ? 'Enable secure boot + lock' : 'Enable secure boot',
      PRESENCE_TIMEOUT_MS
    );
  }
}
