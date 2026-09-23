// SPDX-License-Identifier: AGPL-3.0-only
//
// Pure protocol helpers for the pico-keys "rescue" applet. No DOM or WebUSB.
// Wire format (pico-keys-sdk main, firmware 8.x):
//   src/usb/ccid/ccid.c  CCID framing on the WebCCID interface
//   src/rescue.c         rescue applet SELECT / READ / WRITE / SECURE
//   src/fs/phy.{h,c}     PHY configuration TLV record

/* ------------------------------------------------------------------ */
/* Bytes                                                               */
/* ------------------------------------------------------------------ */

export function toHex(bytes: Uint8Array, sep = ' '): string {
  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0').toUpperCase()
  ).join(sep);
}

export function fromHex(str: string): Uint8Array {
  const clean = String(str)
    .replace(/0x/gi, '')
    .replace(/[\s:,-]/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function hex16(n: number | null | undefined): string {
  return n == null ? '' : n.toString(16).toUpperCase().padStart(4, '0');
}

export function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CCID                                                                */
/* ------------------------------------------------------------------ */

export const CCID = {
  HEADER_SIZE: 10,
  PC_TO_RDR_ICC_POWER_ON: 0x62,
  PC_TO_RDR_ICC_POWER_OFF: 0x63,
  PC_TO_RDR_XFR_BLOCK: 0x6f,
  RDR_TO_PC_DATA_BLOCK: 0x80,
  CMD_STATUS_MASK: 0xc0,
  CMD_STATUS_FAILED: 0x40,
  CMD_STATUS_TIME_EXTENSION: 0x80,
} as const;

export function buildCcid(
  messageType: number,
  seq: number,
  payload: Uint8Array = new Uint8Array(0)
): Uint8Array {
  const msg = new Uint8Array(CCID.HEADER_SIZE + payload.length);
  const len = payload.length;
  msg[0] = messageType;
  msg[1] = len & 0xff;
  msg[2] = (len >>> 8) & 0xff;
  msg[3] = (len >>> 16) & 0xff;
  msg[4] = (len >>> 24) & 0xff;
  msg[6] = seq & 0xff;
  msg.set(payload, CCID.HEADER_SIZE);
  return msg;
}

export interface CcidHeader {
  type: number;
  length: number;
  slot: number;
  seq: number;
  status: number;
  error: number;
  totalLength: number;
}

export function parseCcidHeader(buf: Uint8Array): CcidHeader | null {
  if (buf.length < CCID.HEADER_SIZE) return null;
  const length =
    (buf[1] | (buf[2] << 8) | (buf[3] << 16) | (buf[4] << 24)) >>> 0;
  return {
    type: buf[0],
    length,
    slot: buf[5],
    seq: buf[6],
    status: buf[7],
    error: buf[8],
    totalLength: CCID.HEADER_SIZE + length,
  };
}

export function ccidCommandStatus(
  h: Pick<CcidHeader, 'status'>
): 'ok' | 'time-extension' | 'failed' {
  const s = h.status & CCID.CMD_STATUS_MASK;
  if (s === CCID.CMD_STATUS_TIME_EXTENSION) return 'time-extension';
  if (s === CCID.CMD_STATUS_FAILED) return 'failed';
  return 'ok';
}

/* ------------------------------------------------------------------ */
/* APDU                                                                */
/* ------------------------------------------------------------------ */

export interface ApduSpec {
  cla: number;
  ins: number;
  p1?: number;
  p2?: number;
  data?: Uint8Array | null;
  /** null = no Le byte, 0 = up to 256 bytes */
  le?: number | null;
}

export function buildApdu({
  cla,
  ins,
  p1 = 0,
  p2 = 0,
  data = null,
  le = 0,
}: ApduSpec): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(cla, ins, p1, p2)];
  if (data && data.length > 0) {
    if (data.length > 255) {
      throw new Error('APDU data too long for short form (max 255 bytes)');
    }
    parts.push(Uint8Array.of(data.length), data);
  }
  if (le !== null && le !== undefined) parts.push(Uint8Array.of(le & 0xff));
  return concat(...parts);
}

export interface ApduResponse {
  data: Uint8Array;
  sw1: number;
  sw2: number;
  sw: number;
}

export function parseResponse(bytes: Uint8Array): ApduResponse {
  if (bytes.length < 2) throw new Error('Response APDU shorter than 2 bytes');
  const sw1 = bytes[bytes.length - 2];
  const sw2 = bytes[bytes.length - 1];
  return { data: bytes.slice(0, -2), sw1, sw2, sw: (sw1 << 8) | sw2 };
}

const SW_TEXT: Record<number, string> = {
  0x9000: 'OK',
  0x6400: 'Execution error',
  0x6581: 'Memory failure',
  0x6700: 'Wrong length',
  0x6982: 'Security status not satisfied',
  0x6985: 'Conditions not satisfied (BOOT button not pressed in time?)',
  0x6a80: 'Incorrect parameters in data',
  0x6a82: 'File or applet not found',
  0x6a86: 'Incorrect P1/P2',
  0x6d00: 'Instruction not supported by this firmware or MCU',
  0x6e00: 'Class not supported',
  0x6f00: 'Unknown error',
};

export function swText(sw: number): string {
  if ((sw & 0xff00) === 0x6100) return `${sw & 0xff} more bytes available`;
  if ((sw & 0xff00) === 0x6c00) return `Wrong Le, expected ${sw & 0xff}`;
  return SW_TEXT[sw] ?? 'Unknown status';
}

export class ApduError extends Error {
  readonly sw: number;
  constructor(sw: number, context: string) {
    super(`${context}: SW ${hex16(sw)} (${swText(sw)})`);
    this.name = 'ApduError';
    this.sw = sw;
  }
}

/* ------------------------------------------------------------------ */
/* Rescue applet                                                       */
/* ------------------------------------------------------------------ */

export const RESCUE_AID = Uint8Array.of(
  0xa0,
  0x58,
  0x3f,
  0xc1,
  0x9b,
  0x7e,
  0x4f,
  0x21
);

const CLA = 0x80;
export const RESCUE_INS = {
  KEYDEV_SIGN: 0x10,
  WRITE: 0x1c,
  SECURE: 0x1d,
  READ: 0x1e,
  REBOOT: 0x1f,
} as const;

export const APDU = {
  selectRescue: () =>
    buildApdu({ cla: 0x00, ins: 0xa4, p1: 0x04, data: RESCUE_AID, le: 0 }),
  readPhy: () => buildApdu({ cla: CLA, ins: RESCUE_INS.READ, p1: 0x01 }),
  readFlashInfo: () => buildApdu({ cla: CLA, ins: RESCUE_INS.READ, p1: 0x02 }),
  readSecureBoot: () => buildApdu({ cla: CLA, ins: RESCUE_INS.READ, p1: 0x03 }),
  writePhy: (tlv: Uint8Array) =>
    buildApdu({
      cla: CLA,
      ins: RESCUE_INS.WRITE,
      p1: 0x01,
      data: tlv,
      le: null,
    }),
  /** IRREVERSIBLE on real hardware. P1 = boot key slot, P2 = 1 for lock. */
  enableSecureBoot: (bootKey: number, lock: boolean) =>
    buildApdu({
      cla: CLA,
      ins: RESCUE_INS.SECURE,
      p1: bootKey,
      p2: lock ? 1 : 0,
      le: null,
    }),
  reboot: (toBootloader: boolean) =>
    buildApdu({
      cla: CLA,
      ins: RESCUE_INS.REBOOT,
      p1: toBootloader ? 1 : 0,
      le: null,
    }),
  getResponse: (le: number) => buildApdu({ cla: 0x00, ins: 0xc0, le }),
};

export const MCU = {
  RP2040: 0,
  RP2350: 1,
  ESP32S3: 2,
  EMULATION: 3,
  ESP32S2: 4,
} as const;
export type McuId = (typeof MCU)[keyof typeof MCU] | number;

export const MCU_NAMES: Record<number, string> = {
  0: 'RP2040',
  1: 'RP2350',
  2: 'ESP32-S3',
  3: 'Emulation',
  4: 'ESP32-S2',
};
export const PRODUCT_NAMES: Record<number, string> = {
  2: 'Pico FIDO',
  3: 'Pico OpenPGP',
};

export const isEsp = (mcu: McuId | null | undefined) =>
  mcu === MCU.ESP32S3 || mcu === MCU.ESP32S2;

/** Number of secure-boot key slots, or null if the MCU has none. */
export function secureBootSlots(mcu: McuId | null | undefined): number | null {
  if (isEsp(mcu)) return 3;
  if (mcu === MCU.RP2350) return 4;
  return null;
}

export interface DeviceInfo {
  mcu: number;
  mcuName: string;
  product: number;
  productName: string;
  versionMajor: number;
  versionMinor: number;
  version: string;
  serialHex: string;
  serialDecimal: number | null;
  build: number | null;
}

export function parseSelect(data: Uint8Array): DeviceInfo {
  if (data.length < 4) throw new Error('SELECT response too short');
  const serial = data.length >= 12 ? data.slice(4, 12) : new Uint8Array(0);
  return {
    mcu: data[0],
    mcuName: MCU_NAMES[data[0]] ?? `Unknown (${data[0]})`,
    product: data[1],
    productName: PRODUCT_NAMES[data[1]] ?? `Product ${data[1]}`,
    versionMajor: data[2],
    versionMinor: data[3],
    version: `${data[2]}.${data[3]}`,
    serialHex: toHex(serial, ''),
    serialDecimal:
      serial.length >= 4
        ? u32be(
            Uint8Array.of(serial[0] & 0x03, serial[1], serial[2], serial[3]),
            0
          )
        : null,
    build: data.length >= 16 ? u32be(data, 12) : null,
  };
}

export interface FlashInfo {
  free: number | null;
  used: number | null;
  total: number | null;
  files: number | null;
  chipSize: number | null;
  firmwareSize: number | null;
}

export function parseFlashInfo(data: Uint8Array): FlashInfo {
  const at = (i: number) =>
    data.length >= (i + 1) * 4 ? u32be(data, i * 4) : null;
  return {
    free: at(0),
    used: at(1),
    total: at(2),
    files: at(3),
    chipSize: at(4),
    firmwareSize: at(5),
  };
}

export interface SecureBootStatus {
  enabled: boolean;
  locked: boolean;
  bootKey: number | null;
}

export function parseSecureBoot(data: Uint8Array): SecureBootStatus {
  if (data.length < 3) throw new Error('Secure boot status response too short');
  return {
    enabled: data[0] !== 0,
    locked: data[1] !== 0,
    bootKey: data[2] === 0xff ? null : data[2],
  };
}

/* ------------------------------------------------------------------ */
/* PHY configuration                                                   */
/* ------------------------------------------------------------------ */

export const PHY_TAG = {
  VIDPID: 0x00,
  LED_GPIO: 0x04,
  LED_BRIGHTNESS: 0x05,
  OPTS: 0x06,
  UP_BTN: 0x08,
  USB_PRODUCT: 0x09,
  ENABLED_CURVES: 0x0a,
  ENABLED_USB_ITF: 0x0b,
  LED_DRIVER: 0x0c,
} as const;

export const PHY_OPT = {
  WCID: 0x1,
  DIMM: 0x2,
  DISABLE_POWER_RESET: 0x4,
  LED_STEADY: 0x8,
} as const;

export interface BitOption {
  bit: number;
  name: string;
}

export const CURVES: readonly BitOption[] = [
  { bit: 0x001, name: 'secp256r1 (P-256)' },
  { bit: 0x002, name: 'secp384r1 (P-384)' },
  { bit: 0x004, name: 'secp521r1 (P-521)' },
  { bit: 0x008, name: 'secp256k1' },
  { bit: 0x010, name: 'brainpoolP256r1' },
  { bit: 0x020, name: 'brainpoolP384r1' },
  { bit: 0x040, name: 'brainpoolP512r1' },
  { bit: 0x080, name: 'Ed25519' },
  { bit: 0x100, name: 'Ed448' },
  { bit: 0x200, name: 'Curve25519 (X25519)' },
  { bit: 0x400, name: 'Curve448 (X448)' },
];

export const USB_ITF: readonly BitOption[] = [
  { bit: 0x01, name: 'CCID (smart card)' },
  { bit: 0x02, name: 'WebCCID (WebUSB, used by Keyforge)' },
  { bit: 0x04, name: 'HID (FIDO and passkeys)' },
  { bit: 0x08, name: 'HID keyboard (OTP typing)' },
  { bit: 0x10, name: 'LWIP (USB network)' },
];
export const USB_ITF_ALL = 0x1f;
export const USB_ITF_BIT = {
  CCID: 0x01,
  WCID: 0x02,
  HID: 0x04,
  KB: 0x08,
  LWIP: 0x10,
} as const;

export interface LedDriver {
  id: number;
  name: string;
  platform: 'rp' | 'esp' | 'any';
}

export const LED_DRIVERS: readonly LedDriver[] = [
  { id: 0x01, name: 'Pico GPIO (single LED)', platform: 'rp' },
  { id: 0x02, name: 'Pimoroni RGB', platform: 'rp' },
  { id: 0x03, name: 'WS2812 via PIO', platform: 'rp' },
  { id: 0x04, name: 'CYW43 (Pico W)', platform: 'rp' },
  { id: 0x05, name: 'NeoPixel / WS2812 (ESP32)', platform: 'esp' },
  { id: 0xff, name: 'None (LED off)', platform: 'any' },
];

export const LED_ORDERS = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'] as const;
export const MAX_BRIGHTNESS = 15;

/**
 * pico-fido's LED states and the colour the firmware asks for (led.h).
 * Colours are fixed in firmware; only the channel order (PHY_LED_DRIVER byte 2)
 * is configurable, so a "palette" is one of the six channel permutations.
 */
export const LED_STATES = [
  { id: 'idle', label: 'Ready', rgb: [0, 255, 0] },
  { id: 'nohost', label: 'No computer', rgb: [255, 0, 0] },
  { id: 'touch', label: 'Press BOOT', rgb: [255, 255, 0] },
  { id: 'sleep', label: 'Asleep', rgb: [0, 0, 255] },
] as const;

export type Rgb = readonly [number, number, number];

/** Same mapping as firmware neopixel_rgb_ordered(). */
export function applyLedOrder(order: number, [r, g, b]: Rgb): Rgb {
  switch (order) {
    case 1:
      return [r, b, g]; // RBG
    case 2:
      return [g, r, b]; // GRB
    case 3:
      return [g, b, r]; // GBR
    case 4:
      return [b, r, g]; // BRG
    case 5:
      return [b, g, r]; // BGR
    default:
      return [r, g, b]; // RGB
  }
}

export const LED_PALETTES = [
  { order: 0, name: 'Classic' },
  { order: 1, name: 'Ocean' },
  { order: 2, name: 'Inverted' },
  { order: 3, name: 'Twilight' },
  { order: 4, name: 'Aurora' },
  { order: 5, name: 'Ember' },
] as const;

export type Primary = 'red' | 'green' | 'blue';
export const PRIMARIES: { id: Primary; label: string; rgb: Rgb }[] = [
  { id: 'red', label: 'Red', rgb: [255, 0, 0] },
  { id: 'green', label: 'Green', rgb: [0, 255, 0] },
  { id: 'blue', label: 'Blue', rgb: [0, 0, 255] },
];

const same = (a: Rgb, b: Rgb) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * The channel order that shows `ready` when idle and `noHost` when unplugged
 * from a computer. These two choices fix the permutation, so the other states
 * follow. Returns null if both colours are the same.
 */
export function orderFor(ready: Primary, noHost: Primary): number | null {
  const want = (p: Primary) => PRIMARIES.find((x) => x.id === p)!.rgb;
  for (let order = 0; order < LED_ORDERS.length; order++) {
    if (
      same(applyLedOrder(order, [0, 255, 0]), want(ready)) &&
      same(applyLedOrder(order, [255, 0, 0]), want(noHost))
    ) {
      return order;
    }
  }
  return null;
}

/** Inverse of orderFor: which primaries an order produces for Ready / No computer. */
export function primariesOf(order: number): {
  ready: Primary;
  noHost: Primary;
} {
  const name = (c: Rgb) => PRIMARIES.find((p) => same(p.rgb, c))!.id;
  return {
    ready: name(applyLedOrder(order, [0, 255, 0])),
    noHost: name(applyLedOrder(order, [255, 0, 0])),
  };
}

/** Colour the LED shows in a state for a channel order and brightness (0-15). */
export function ledColour(
  order: number,
  state: Rgb,
  brightness = MAX_BRIGHTNESS
): string {
  const k = Math.max(0.12, brightness / MAX_BRIGHTNESS);
  const [r, g, b] = applyLedOrder(order, state).map((v) => Math.round(v * k));
  return `rgb(${r} ${g} ${b})`;
}

export interface PhyConfig {
  vid: number | null;
  pid: number | null;
  ledGpio: number | null;
  ledBrightness: number | null;
  opts: number;
  upBtn: number | null;
  usbProduct: string | null;
  curves: number | null;
  usbItf: number | null;
  ledDriver: number | null;
  ledOrder: number | null;
  unknown: { tag: number; value: Uint8Array }[];
}

export function emptyPhy(): PhyConfig {
  return {
    vid: null,
    pid: null,
    ledGpio: null,
    ledBrightness: null,
    opts: 0,
    upBtn: null,
    usbProduct: null,
    curves: null,
    usbItf: null,
    ledDriver: null,
    ledOrder: null,
    unknown: [],
  };
}

/** Parse like firmware phy_unserialize_data. */
export function parsePhy(bytes: Uint8Array): {
  config: PhyConfig;
  truncated: boolean;
} {
  const cfg = emptyPhy();
  let truncated = false;
  let p = 0;
  while (p + 2 <= bytes.length) {
    const tag = bytes[p];
    const len = bytes[p + 1];
    p += 2;
    if (len > bytes.length - p) {
      truncated = true;
      break;
    }
    const v = bytes.slice(p, p + len);
    p += len;
    switch (tag) {
      case PHY_TAG.VIDPID:
        if (len === 4) {
          cfg.vid = (v[0] << 8) | v[1];
          cfg.pid = (v[2] << 8) | v[3];
        }
        break;
      case PHY_TAG.LED_GPIO:
        if (len === 1) cfg.ledGpio = v[0];
        break;
      case PHY_TAG.LED_BRIGHTNESS:
        if (len === 1) cfg.ledBrightness = v[0];
        break;
      case PHY_TAG.OPTS:
        if (len === 2) cfg.opts = (v[0] << 8) | v[1];
        break;
      case PHY_TAG.UP_BTN:
        if (len === 1) cfg.upBtn = v[0];
        break;
      case PHY_TAG.USB_PRODUCT:
        if (len > 0 && len <= 32) {
          let end = len;
          while (end > 0 && v[end - 1] === 0) end--;
          cfg.usbProduct = new TextDecoder().decode(v.slice(0, end));
        }
        break;
      case PHY_TAG.ENABLED_CURVES:
        if (len === 4) cfg.curves = u32be(v, 0);
        break;
      case PHY_TAG.ENABLED_USB_ITF:
        if (len === 1) cfg.usbItf = v[0];
        break;
      case PHY_TAG.LED_DRIVER:
        if (len >= 1) {
          cfg.ledDriver = v[0];
          if (len >= 2) cfg.ledOrder = v[1];
        }
        break;
      default:
        cfg.unknown.push({ tag, value: v });
    }
  }
  if (p < bytes.length && !truncated) truncated = true;
  return { config: cfg, truncated };
}

export function validatePhy(cfg: PhyConfig): string[] {
  const errors: string[] = [];
  const isByte = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xff;
  if ((cfg.vid == null) !== (cfg.pid == null)) {
    errors.push('VID and PID must be set together.');
  }
  for (const [k, n] of [
    ['VID', cfg.vid],
    ['PID', cfg.pid],
  ] as const) {
    if (n != null && !(Number.isInteger(n) && n > 0 && n <= 0xffff)) {
      errors.push(`${k} must be 0001-FFFF.`);
    }
  }
  if (cfg.ledGpio != null && !isByte(cfg.ledGpio)) {
    errors.push('LED GPIO must be 0-255.');
  }
  if (
    cfg.ledBrightness != null &&
    !(isByte(cfg.ledBrightness) && cfg.ledBrightness <= MAX_BRIGHTNESS)
  ) {
    errors.push(`LED brightness must be 0-${MAX_BRIGHTNESS}.`);
  }
  if (!(Number.isInteger(cfg.opts) && cfg.opts >= 0 && cfg.opts <= 0xffff)) {
    errors.push('Options must be a 16-bit value.');
  }
  if (cfg.upBtn != null && !isByte(cfg.upBtn)) {
    errors.push('Button timeout must be 0-255 seconds.');
  }
  if (cfg.usbProduct != null) {
    if (!/^[\x20-\x7e]*$/.test(cfg.usbProduct)) {
      errors.push('USB product name must be printable ASCII.');
    } else if (cfg.usbProduct.length === 0) {
      errors.push('USB product name cannot be empty.');
    } else if (cfg.usbProduct.length > 31) {
      errors.push('USB product name must be at most 31 characters.');
    }
  }
  if (
    cfg.curves != null &&
    !(
      Number.isInteger(cfg.curves) &&
      cfg.curves >= 0 &&
      cfg.curves <= 0xffffffff
    )
  ) {
    errors.push('Curve mask must be a 32-bit value.');
  }
  if (cfg.usbItf != null) {
    if (!isByte(cfg.usbItf) || cfg.usbItf & ~USB_ITF_ALL) {
      errors.push('Unknown USB interface bits set.');
    } else if (cfg.usbItf === 0) {
      errors.push('At least one USB interface must stay enabled.');
    }
  }
  if (
    cfg.ledDriver != null &&
    !LED_DRIVERS.some((d) => d.id === cfg.ledDriver)
  ) {
    errors.push('Unknown LED driver.');
  }
  if (cfg.ledOrder != null) {
    if (cfg.ledDriver == null) {
      errors.push('LED colour order needs an explicit LED driver.');
    }
    if (!(
      Number.isInteger(cfg.ledOrder) &&
      cfg.ledOrder >= 0 &&
      cfg.ledOrder < LED_ORDERS.length
    )) {
      errors.push('Unknown LED colour order.');
    }
  }
  return errors;
}

/** Serialize in firmware order (phy_serialize_data). */
export function serializePhy(cfg: PhyConfig): Uint8Array {
  const errors = validatePhy(cfg);
  if (errors.length) throw new Error(errors.join(' '));
  const out: number[] = [];
  const push = (tag: number, ...vals: number[]) =>
    out.push(tag, vals.length, ...vals);
  if (cfg.vid != null && cfg.pid != null) {
    push(
      PHY_TAG.VIDPID,
      cfg.vid >> 8,
      cfg.vid & 0xff,
      cfg.pid >> 8,
      cfg.pid & 0xff
    );
  }
  if (cfg.ledGpio != null) push(PHY_TAG.LED_GPIO, cfg.ledGpio);
  if (cfg.ledBrightness != null)
    push(PHY_TAG.LED_BRIGHTNESS, cfg.ledBrightness);
  push(PHY_TAG.OPTS, (cfg.opts >> 8) & 0xff, cfg.opts & 0xff);
  if (cfg.upBtn != null) push(PHY_TAG.UP_BTN, cfg.upBtn);
  if (cfg.usbProduct != null) {
    push(PHY_TAG.USB_PRODUCT, ...new TextEncoder().encode(cfg.usbProduct), 0);
  }
  if (cfg.curves != null) {
    const c = cfg.curves >>> 0;
    push(
      PHY_TAG.ENABLED_CURVES,
      (c >>> 24) & 0xff,
      (c >>> 16) & 0xff,
      (c >>> 8) & 0xff,
      c & 0xff
    );
  }
  if (cfg.usbItf != null) push(PHY_TAG.ENABLED_USB_ITF, cfg.usbItf);
  if (cfg.ledDriver != null) {
    if (cfg.ledOrder != null)
      push(PHY_TAG.LED_DRIVER, cfg.ledDriver, cfg.ledOrder);
    else push(PHY_TAG.LED_DRIVER, cfg.ledDriver);
  }
  for (const u of cfg.unknown) {
    if (u.value.length > 255)
      throw new Error(`Unknown tag 0x${u.tag.toString(16)} too long`);
    out.push(u.tag, u.value.length, ...u.value);
  }
  if (out.length > 255)
    throw new Error('Configuration record exceeds 255 bytes');
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------------ */
/* Boards and safety                                                   */
/* ------------------------------------------------------------------ */

export interface BoardPreset {
  id: string;
  name: string;
  mcu: number;
  apply: Partial<PhyConfig>;
}

export const BOARD_PRESETS: readonly BoardPreset[] = [
  {
    id: 'waveshare-esp32-s3-zero',
    name: 'Waveshare ESP32-S3-Zero (WS2812 on GPIO 21)',
    mcu: MCU.ESP32S3,
    apply: { ledDriver: 0x05, ledGpio: 21 },
  },
  {
    id: 'espressif-devkitc-1-v10',
    name: 'ESP32-S3-DevKitC-1 v1.0 (RGB LED on GPIO 48)',
    mcu: MCU.ESP32S3,
    apply: { ledDriver: 0x05, ledGpio: 48 },
  },
  {
    id: 'espressif-devkitc-1-v11',
    name: 'ESP32-S3-DevKitC-1 v1.1 (RGB LED on GPIO 38)',
    mcu: MCU.ESP32S3,
    apply: { ledDriver: 0x05, ledGpio: 38 },
  },
  {
    id: 'raspberry-pi-pico',
    name: 'Raspberry Pi Pico (LED on GPIO 25)',
    mcu: MCU.RP2040,
    apply: { ledDriver: 0x01, ledGpio: 25 },
  },
  {
    id: 'raspberry-pi-pico2',
    name: 'Raspberry Pi Pico 2 (LED on GPIO 25)',
    mcu: MCU.RP2350,
    apply: { ledDriver: 0x01, ledGpio: 25 },
  },
];

export const DEFAULT_LED_GPIO: Record<number, number> = {
  [MCU.ESP32S3]: 48,
  [MCU.ESP32S2]: 15,
};

export const GPIO_MAX: Record<number, number> = {
  [MCU.ESP32S3]: 48,
  [MCU.ESP32S2]: 46,
  [MCU.RP2040]: 29,
  [MCU.RP2350]: 47,
};

export interface Risk {
  level: 'block' | 'warn';
  reason: string;
}

export function gpioRisk(
  mcu: number | null | undefined,
  gpio: number | null
): Risk | null {
  if (gpio == null) return null;
  if (mcu === MCU.ESP32S3) {
    if (gpio > 48)
      return { level: 'block', reason: 'ESP32-S3 has GPIO 0-48 only.' };
    if (gpio === 19 || gpio === 20) {
      return {
        level: 'block',
        reason:
          'GPIO 19/20 are the USB D-/D+ pins. The key would vanish from USB.',
      };
    }
    if (gpio >= 26 && gpio <= 32) {
      return {
        level: 'block',
        reason:
          'GPIO 26-32 drive the SPI flash and PSRAM. The board would crash.',
      };
    }
    if (gpio === 0)
      return {
        level: 'block',
        reason: 'GPIO 0 is the BOOT button used for user presence.',
      };
    if (gpio >= 22 && gpio <= 25)
      return { level: 'block', reason: 'GPIO 22-25 do not exist on ESP32-S3.' };
    if (gpio >= 33 && gpio <= 37) {
      return {
        level: 'warn',
        reason:
          'GPIO 33-37 are used by octal PSRAM on some modules (N8R8, N16R8).',
      };
    }
    if (gpio === 3 || gpio === 45 || gpio === 46)
      return {
        level: 'warn',
        reason: 'Strapping pin. It may affect boot mode.',
      };
    if (gpio === 43 || gpio === 44)
      return {
        level: 'warn',
        reason: 'GPIO 43/44 are the UART0 console pins.',
      };
  } else if (mcu === MCU.ESP32S2) {
    if (gpio > 46)
      return { level: 'block', reason: 'ESP32-S2 has GPIO 0-46 only.' };
    if (gpio === 19 || gpio === 20)
      return { level: 'block', reason: 'GPIO 19/20 are the USB D-/D+ pins.' };
    if (gpio >= 26 && gpio <= 32)
      return {
        level: 'block',
        reason: 'GPIO 26-32 drive the SPI flash and PSRAM.',
      };
    if (gpio === 0)
      return { level: 'block', reason: 'GPIO 0 is the BOOT button.' };
  } else if (mcu === MCU.RP2040 && gpio > 29) {
    return { level: 'block', reason: 'RP2040 has GPIO 0-29 only.' };
  } else if (mcu === MCU.RP2350 && gpio > 47) {
    return { level: 'block', reason: 'RP2350 has GPIO 0-47 only.' };
  }
  return null;
}

export function reviewPhy(
  before: PhyConfig | null,
  after: PhyConfig,
  mcu: number | null
): { errors: string[]; warnings: string[] } {
  const errors = validatePhy(after);
  const warnings: string[] = [];

  const risk = gpioRisk(mcu, after.ledGpio);
  if (risk?.level === 'block')
    errors.push(`LED GPIO ${after.ledGpio}: ${risk.reason}`);
  if (risk?.level === 'warn')
    warnings.push(`LED GPIO ${after.ledGpio}: ${risk.reason}`);

  if (after.ledDriver != null && mcu != null && mcu !== MCU.EMULATION) {
    const drv = LED_DRIVERS.find((d) => d.id === after.ledDriver);
    if (drv?.platform === 'rp' && isEsp(mcu))
      errors.push(`LED driver "${drv.name}" is not available on ESP32.`);
    if (drv?.platform === 'esp' && !isEsp(mcu))
      errors.push(`LED driver "${drv.name}" is only available on ESP32.`);
  }

  const itf = after.usbItf ?? USB_ITF_ALL;
  const prev = before?.usbItf ?? USB_ITF_ALL;
  if (!(itf & USB_ITF_BIT.WCID) && prev & USB_ITF_BIT.WCID) {
    warnings.push(
      'WebCCID is disabled. Keyforge will no longer reach the key after replug; only a reflash or a CCID tool can undo it.'
    );
  }
  if (!(itf & USB_ITF_BIT.HID) && prev & USB_ITF_BIT.HID) {
    warnings.push(
      'HID is disabled. Passkeys, FIDO2 and WebAuthn will stop working.'
    );
  }
  if (!(itf & USB_ITF_BIT.CCID) && prev & USB_ITF_BIT.CCID) {
    warnings.push(
      'CCID is disabled. OpenPGP, PIV and OATH smart-card tools will stop working.'
    );
  }
  if (
    after.vid !== (before?.vid ?? null) ||
    after.pid !== (before?.pid ?? null)
  ) {
    warnings.push(
      'USB VID/PID changes. Only use IDs you are allowed to use, and never distribute devices with VID/PIDs you do not own.'
    );
  }
  if (after.ledDriver === 0xff)
    warnings.push('LED driver "None": the status LED will stay dark.');
  if (after.ledBrightness === 0)
    warnings.push('Brightness 0: the status LED will stay dark.');
  if ((before?.upBtn ?? 0) > 0 && !((after.upBtn ?? 0) > 0)) {
    warnings.push(
      'BOOT-button confirmation is turned off. Operations will be approved without a physical press.'
    );
  }
  if (after.curves != null && !(after.curves & 0x001)) {
    warnings.push(
      'secp256r1 (P-256) is disabled. Most passkeys use ES256 and will fail.'
    );
  }
  return { errors, warnings };
}

export function describePhy(cfg: PhyConfig): [string, string][] {
  const d = <T>(v: T | null, f: (x: T) => string = String) =>
    v == null ? 'default' : f(v);
  const bits = (mask: number | null, table: readonly BitOption[]) =>
    mask == null
      ? 'default (all)'
      : table
          .filter((t) => mask & t.bit)
          .map((t) => t.name.split(' (')[0])
          .join(', ') || 'none';
  const drv = (id: number) =>
    LED_DRIVERS.find((x) => x.id === id)?.name ?? `0x${id.toString(16)}`;
  return [
    [
      'USB VID:PID',
      cfg.vid == null ? 'default' : `${hex16(cfg.vid)}:${hex16(cfg.pid)}`,
    ],
    ['USB product name', d(cfg.usbProduct)],
    ['LED driver', d(cfg.ledDriver, drv)],
    ['LED GPIO', d(cfg.ledGpio)],
    ['LED colour order', d(cfg.ledOrder, (o) => LED_ORDERS[o] ?? String(o))],
    ['LED brightness', d(cfg.ledBrightness, (b) => `${b}/${MAX_BRIGHTNESS}`)],
    ['LED dimmable', cfg.opts & PHY_OPT.DIMM ? 'yes' : 'no'],
    ['LED steady', cfg.opts & PHY_OPT.LED_STEADY ? 'yes' : 'no'],
    [
      'Power-cycle on reset',
      cfg.opts & PHY_OPT.DISABLE_POWER_RESET ? 'no' : 'yes',
    ],
    [
      'BOOT-button confirmation',
      cfg.upBtn ? `required, ${cfg.upBtn} s timeout` : 'firmware default',
    ],
    ['USB interfaces', bits(cfg.usbItf, USB_ITF)],
    ['Curves', bits(cfg.curves, CURVES)],
    [
      'Unknown tags',
      cfg.unknown.length
        ? cfg.unknown.map((u) => `0x${u.tag.toString(16)}`).join(', ')
        : 'none',
    ],
  ];
}

export function diffPhy(
  before: PhyConfig,
  after: PhyConfig
): [string, string, string][] {
  const a = describePhy(before);
  return describePhy(after)
    .map((row, i): [string, string, string] => [row[0], a[i][1], row[1]])
    .filter((row) => row[1] !== row[2]);
}
