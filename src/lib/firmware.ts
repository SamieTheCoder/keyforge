// SPDX-License-Identifier: AGPL-3.0-only
//
// Flasher helpers: firmware file inspection (ESP image, UF2), release-asset
// matching, MD5 for esptool's post-write verify. Pure, unit tested.

import { SITE } from './site';

/* ------------------------------------------------------------------ */
/* ESP image header                                                    */
/* ------------------------------------------------------------------ */

export const ESP_IMAGE_MAGIC = 0xe9;

export const ESP_CHIP_IDS: Record<number, string> = {
  0x0000: 'ESP32',
  0x0002: 'ESP32-S2',
  0x0005: 'ESP32-C3',
  0x0009: 'ESP32-S3',
  0x000c: 'ESP32-C2',
  0x000d: 'ESP32-C6',
  0x0010: 'ESP32-H2',
  0x0012: 'ESP32-P4',
};

const FLASH_MODES = ['QIO', 'QOUT', 'DIO', 'DOUT'];
const FLASH_SIZES: Record<number, string> = {
  0: '1MB',
  1: '2MB',
  2: '4MB',
  3: '8MB',
  4: '16MB',
  5: '32MB',
  6: '64MB',
  7: '128MB',
};

export const ESP_BOOTLOADER_OFFSET: Record<string, number> = {
  ESP32: 0x1000,
  'ESP32-S2': 0x1000,
  'ESP32-S3': 0x0,
  'ESP32-C3': 0x0,
};

export interface EspImageInfo {
  offset: number;
  segments: number;
  flashMode: string;
  flashSize: string;
  chipId: number;
  chip: string;
  minChipRev: number;
  size: number;
}

export function inspectEspImage(bytes: Uint8Array): EspImageInfo | null {
  for (const offset of [0x0, 0x1000]) {
    if (bytes.length < offset + 24 || bytes[offset] !== ESP_IMAGE_MAGIC) continue;
    if (offset === 0x1000 && !bytes.subarray(0, 0x1000).every((b) => b === 0xff)) continue;
    const h = bytes.subarray(offset);
    const chipId = h[12] | (h[13] << 8);
    return {
      offset,
      segments: h[1],
      flashMode: FLASH_MODES[h[2]] ?? `mode ${h[2]}`,
      flashSize: FLASH_SIZES[h[3] >> 4] ?? 'unknown',
      chipId,
      chip: ESP_CHIP_IDS[chipId] ?? `unknown chip (0x${chipId.toString(16)})`,
      minChipRev: h[14],
      size: bytes.length,
    };
  }
  return null;
}

/** "ESP32-S3 (QFN56) (revision v0.2)" -> "ESP32-S3" */
export function normaliseChip(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const m = /ESP32(-[SCHP]\d+)?/i.exec(desc);
  return m ? m[0].toUpperCase() : null;
}

export interface FlashPlan {
  errors: string[];
  warnings: string[];
  address: number | null;
}

export function planEspFlash(image: EspImageInfo | null, connectedChip: string | null): FlashPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!image) {
    errors.push('This is not an ESP32 firmware image (no 0xE9 header). Pick the merged .bin from the release.');
    return { errors, warnings, address: null };
  }
  const chip = normaliseChip(connectedChip);
  if (chip && image.chip !== chip) {
    errors.push(`This firmware is built for ${image.chip}, but the connected chip is ${chip}.`);
  }
  if (image.offset === 0 && ESP_BOOTLOADER_OFFSET[image.chip] === 0x1000) {
    warnings.push(`${image.chip} expects the bootloader at 0x1000. If this file is not a merged image, it will not boot.`);
  }
  if (image.size < 64 * 1024) warnings.push('The file is unusually small for a full firmware image.');
  return { errors, warnings, address: 0x0 };
}

/* ------------------------------------------------------------------ */
/* UF2                                                                 */
/* ------------------------------------------------------------------ */

export const UF2 = {
  BLOCK: 512,
  MAGIC0: 0x0a324655,
  MAGIC1: 0x9e5d5157,
  MAGIC_END: 0x0ab16f30,
  FLAG_FAMILY: 0x2000,
} as const;

export const UF2_FAMILIES: Record<number, string> = {
  0xe48bff56: 'RP2040',
  0xe48bff57: 'RP2xxx absolute',
  0xe48bff58: 'RP2350 data',
  0xe48bff59: 'RP2350 (Arm)',
  0xe48bff5a: 'RP2350 (RISC-V)',
  0xbfdd4eee: 'ESP32-S2',
  0xc47e5767: 'ESP32-S3',
};

const le32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export interface Uf2Info {
  blocks: number;
  payload: number;
  minAddr: number;
  maxAddr: number;
  families: { id: number; name: string; count: number }[];
  target: string | null;
}

export function parseUf2(bytes: Uint8Array): Uf2Info {
  if (bytes.length === 0 || bytes.length % UF2.BLOCK !== 0) {
    throw new Error('Not a UF2 file: size is not a multiple of 512 bytes.');
  }
  const families = new Map<number, number>();
  let payload = 0;
  let minAddr = Infinity;
  let maxAddr = 0;
  const blocks = bytes.length / UF2.BLOCK;
  for (let i = 0; i < blocks; i++) {
    const o = i * UF2.BLOCK;
    if (le32(bytes, o) !== UF2.MAGIC0 || le32(bytes, o + 4) !== UF2.MAGIC1 || le32(bytes, o + 508) !== UF2.MAGIC_END) {
      throw new Error(`Not a valid UF2 file: block ${i} has a bad magic number.`);
    }
    const flags = le32(bytes, o + 8);
    const addr = le32(bytes, o + 12);
    const size = le32(bytes, o + 16);
    if (size > 476) throw new Error(`Not a valid UF2 file: block ${i} payload is too large.`);
    if (flags & UF2.FLAG_FAMILY) {
      const fam = le32(bytes, o + 28);
      families.set(fam, (families.get(fam) ?? 0) + 1);
    }
    payload += size;
    minAddr = Math.min(minAddr, addr);
    maxAddr = Math.max(maxAddr, addr + size);
  }
  const list = [...families.entries()].map(([fid, count]) => ({
    id: fid,
    name: UF2_FAMILIES[fid] ?? `unknown (0x${fid.toString(16)})`,
    count,
  }));
  return { blocks, payload, minAddr, maxAddr, families: list, target: uf2Target(list) };
}

function uf2Target(families: { name: string }[]): string | null {
  const names = families.map((f) => f.name);
  if (names.includes('RP2040')) return 'RP2040';
  if (names.some((n) => n.startsWith('RP2350'))) return 'RP2350';
  if (names.includes('ESP32-S3')) return 'ESP32-S3';
  if (names.includes('ESP32-S2')) return 'ESP32-S2';
  if (names.includes('RP2xxx absolute')) return 'RP2xxx';
  return null;
}

/** INFO_UF2.TXT on the BOOTSEL drive -> chip. */
export function bootDriveChip(infoText: string | null | undefined): string | null {
  const text = infoText ?? '';
  const board = /Board-ID:\s*(\S+)/i.exec(text)?.[1] ?? '';
  if (/RP2040|RPI-RP2/i.test(board) || /RPI-RP2/.test(text)) return 'RP2040';
  if (/RP2350|RP2\b/i.test(board)) return 'RP2350';
  return board || null;
}

export function planUf2Copy(info: Uf2Info, driveChip: string | null): { errors: string[] } {
  const errors: string[] = [];
  if (!info.target) errors.push('The UF2 file does not say which chip it is for.');
  if (driveChip && info.target && info.target !== 'RP2xxx' && info.target !== driveChip) {
    errors.push(`This firmware is for ${info.target}, but the connected boot drive is ${driveChip}.`);
  }
  return { errors };
}

/* ------------------------------------------------------------------ */
/* UF2 -> flash sectors for PICOBOOT                                   */
/* ------------------------------------------------------------------ */

const FAMILY = {
  RP2040: 0xe48bff56,
  ABSOLUTE: 0xe48bff57,
  DATA: 0xe48bff58,
  RP2350_ARM_S: 0xe48bff59,
  RP2350_RISCV: 0xe48bff5a,
  RP2350_ARM_NS: 0xe48bff5b,
} as const;

const RP_FLASH_START = 0x10000000;
const RP_FLASH_END = 0x11000000;
const RP_SECTOR = 0x1000;
/** The SDK adds one absolute-family block here as the RP2350-E10 drag-and-drop workaround. */
const E10_BLOCK_ADDR = 0x10ffff00;

export interface FlashImage {
  /** 4 KiB sectors, ascending, unused bytes 0xFF. */
  sectors: { addr: number; data: Uint8Array }[];
  bytes: number;
  skippedBlocks: number;
  /** RP2350 only: does an IMAGE_DEF block carry a signature? null = not applicable. */
  signed: boolean | null;
}

export function uf2ToFlashImage(bytes: Uint8Array, chip: 'RP2040' | 'RP2350'): FlashImage {
  parseUf2(bytes); // validates magic and sizes
  const want: number[] =
    chip === 'RP2040' ? [FAMILY.RP2040] : [FAMILY.RP2350_ARM_S, FAMILY.RP2350_RISCV, FAMILY.RP2350_ARM_NS];
  const sectors = new Map<number, Uint8Array>();
  let skipped = 0;
  for (let o = 0; o < bytes.length; o += UF2.BLOCK) {
    const flags = le32(bytes, o + 8);
    const addr = le32(bytes, o + 12);
    const size = le32(bytes, o + 16);
    const fam = flags & UF2.FLAG_FAMILY ? le32(bytes, o + 28) : null;
    if (flags & 0x1) {
      skipped++; // "not main flash" blocks
      continue;
    }
    if (fam !== null && !want.includes(fam) && fam !== FAMILY.DATA && fam !== FAMILY.ABSOLUTE) {
      skipped++;
      continue;
    }
    if (fam === FAMILY.ABSOLUTE && addr === E10_BLOCK_ADDR) {
      skipped++;
      continue;
    }
    if (addr < RP_FLASH_START || addr + size > RP_FLASH_END) {
      throw new Error(
        `This UF2 writes to 0x${addr.toString(16)}, outside flash. It is probably a RAM-only build; use Copy to boot drive instead.`
      );
    }
    const payload = bytes.subarray(o + 32, o + 32 + size);
    let at = addr;
    let i = 0;
    while (i < payload.length) {
      const base = at - (at % RP_SECTOR);
      let s = sectors.get(base);
      if (!s) {
        s = new Uint8Array(RP_SECTOR).fill(0xff);
        sectors.set(base, s);
      }
      const n = Math.min(payload.length - i, base + RP_SECTOR - at);
      s.set(payload.subarray(i, i + n), at - base);
      at += n;
      i += n;
    }
  }
  if (sectors.size === 0) throw new Error(`This UF2 has no blocks for ${chip}.`);
  const list = [...sectors.entries()].sort((a, b) => a[0] - b[0]).map(([addr, data]) => ({ addr, data }));
  return {
    sectors: list,
    bytes: list.length * RP_SECTOR,
    skippedBlocks: skipped,
    signed: chip === 'RP2350' ? hasSignedImageDef(list) : null,
  };
}

/**
 * Walk RP2350 picobin blocks (marker 0xffffded3 ... 0xab123579) in the first
 * 64 KiB and look for a SIGNATURE item (type 0x09). Bounded, never throws.
 */
export function hasSignedImageDef(sectors: { addr: number; data: Uint8Array }[]): boolean {
  const head = new Uint8Array(0x10000).fill(0xff);
  for (const s of sectors) {
    const off = s.addr - RP_FLASH_START;
    if (off >= 0 && off < head.length) head.set(s.data.subarray(0, Math.min(RP_SECTOR, head.length - off)), off);
  }
  for (let p = 0; p + 8 <= head.length; p += 4) {
    if (le32(head, p) !== 0xffffded3) continue;
    let q = p + 4;
    for (let guard = 0; guard < 64 && q + 4 <= head.length; guard++) {
      const type = head[q];
      const big = (type & 0x80) !== 0;
      const words = big ? head[q + 1] | (head[q + 2] << 8) : head[q + 1];
      if ((type & 0x7f) === 0x7f) break; // LAST
      if ((type & 0x7f) === 0x09) return true; // SIGNATURE
      if (words === 0) break;
      q += words * 4;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Release assets                                                      */
/* ------------------------------------------------------------------ */

export type TargetId = 'esp32-s3' | 'esp32-s2' | 'rp2350' | 'rp2040';

export interface Target {
  id: TargetId;
  name: string;
  kind: 'esp' | 'uf2';
  match: RegExp;
}

export const TARGETS: readonly Target[] = [
  { id: 'esp32-s3', name: 'ESP32-S3', kind: 'esp', match: /esp32[-_]?s3.*\.bin$/i },
  { id: 'esp32-s2', name: 'ESP32-S2', kind: 'esp', match: /esp32[-_]?s2.*\.bin$/i },
  { id: 'rp2350', name: 'RP2350 (Pico 2 and others)', kind: 'uf2', match: /\.uf2$/i },
  { id: 'rp2040', name: 'RP2040 (Pico and others)', kind: 'uf2', match: /\.uf2$/i },
];

export interface FirmwareSource {
  repo: string;
  name: string;
  home: string;
  /** Signed with the PicoKeys release key, so it still boots after secure boot is enabled. */
  picoKeysSigned: boolean;
}

export const FIRMWARE_SOURCES: readonly FirmwareSource[] = [
  {
    repo: SITE.firmwareRepo,
    name: 'Keyforge builds',
    home: `https://github.com/${SITE.firmwareRepo}/releases`,
    picoKeysSigned: false,
  },
  {
    repo: 'polhenarejos/pico-fido',
    name: 'pico-fido (official)',
    home: 'https://github.com/polhenarejos/pico-fido/releases',
    picoKeysSigned: true,
  },
  {
    repo: 'librekeys/pico-fido-firmwares',
    name: 'LibreKeys builds (many RP boards)',
    home: 'https://github.com/librekeys/pico-fido-firmwares/releases',
    picoKeysSigned: false,
  },
];

export interface GithubRelease {
  tag_name: string;
  published_at?: string;
  prerelease?: boolean;
  assets?: { name: string; size: number; browser_download_url: string }[];
}

export interface Asset {
  name: string;
  size: number;
  url: string;
  release: string;
  published: string | null;
  prerelease: boolean;
  hint: string | null;
}

export function uf2HintFromName(name: string): 'RP2040' | 'RP2350' | null {
  const n = name.toLowerCase();
  if (/rp2040|qt2040|kb2040/.test(n)) return 'RP2040';
  if (/rp2350|pico2(?!\d)/.test(n)) return 'RP2350';
  // Official and Keyforge names: <project>_pico-8.0.uf2 / <project>_pico_w-8.0.uf2
  if (/[_-]pico(_w)?[-_.]\d/.test(n)) return 'RP2040';
  return null;
}

export function matchAssets(releases: GithubRelease[] | null | undefined, targetId: TargetId): Asset[] {
  const t = TARGETS.find((x) => x.id === targetId);
  if (!t) return [];
  const out: Asset[] = [];
  for (const r of releases ?? []) {
    for (const a of r.assets ?? []) {
      if (!t.match.test(a.name)) continue;
      if (t.kind === 'uf2' && /esp32/i.test(a.name)) continue;
      // Drop UF2s that clearly target the other RP chip.
      const hint = uf2HintFromName(a.name);
      const want = targetId === 'rp2040' ? 'RP2040' : 'RP2350';
      if (t.kind === 'uf2' && hint && hint !== want) continue;
      out.push({
        name: a.name,
        size: a.size,
        url: a.browser_download_url,
        release: r.tag_name,
        published: r.published_at ?? null,
        prerelease: !!r.prerelease || /nightly/i.test(r.tag_name),
        hint,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* MD5 (RFC 1321)                                                      */
/* ------------------------------------------------------------------ */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >>> 6) * 64 + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bits >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return Array.from(new Uint8Array(out.buffer), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return 'n/a';
  if (n >= 1048576) return `${(n / 1048576).toFixed(n % 1048576 ? 2 : 0)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}
