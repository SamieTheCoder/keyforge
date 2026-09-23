// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hasSignedImageDef, UF2, uf2ToFlashImage } from './firmware';
import { buildCommand, decodeRpSecurity, OTP_SECURITY_ROWS } from './picoboot';

function block(
  addr: number,
  payload: Uint8Array,
  family: number | null,
  flags = 0
): Uint8Array {
  const b = new Uint8Array(UF2.BLOCK);
  const v = new DataView(b.buffer);
  v.setUint32(0, UF2.MAGIC0, true);
  v.setUint32(4, UF2.MAGIC1, true);
  v.setUint32(8, flags | (family !== null ? UF2.FLAG_FAMILY : 0), true);
  v.setUint32(12, addr, true);
  v.setUint32(16, payload.length, true);
  v.setUint32(28, family ?? 0, true);
  b.set(payload, 32);
  v.setUint32(508, UF2.MAGIC_END, true);
  return b;
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const RP2040 = 0xe48bff56;
const RP2350 = 0xe48bff59;
const ABS = 0xe48bff57;

test('buildCommand lays out the 32-byte PICOBOOT packet', () => {
  const args = new Uint8Array(16);
  args[0] = 0xaa;
  const c = buildCommand(7, 0x05, 8, 4096, args);
  const v = new DataView(c.buffer);
  assert.equal(c.length, 32);
  assert.equal(v.getUint32(0, true), 0x431fd10b);
  assert.equal(v.getUint32(4, true), 7);
  assert.equal(c[8], 0x05);
  assert.equal(c[9], 8);
  assert.equal(v.getUint16(10, true), 0);
  assert.equal(v.getUint32(12, true), 4096);
  assert.equal(c[16], 0xaa);
});

test('uf2ToFlashImage packs 256-byte blocks into 4 KiB sectors padded with 0xFF', () => {
  const a = new Uint8Array(256).fill(1);
  const b = new Uint8Array(256).fill(2);
  const img = uf2ToFlashImage(
    join(block(0x10000000, a, RP2040), block(0x10001100, b, RP2040)),
    'RP2040'
  );
  assert.deepEqual(
    img.sectors.map((s) => s.addr),
    [0x10000000, 0x10001000]
  );
  assert.equal(img.sectors[0].data[0], 1);
  assert.equal(img.sectors[0].data[256], 0xff);
  assert.equal(img.sectors[1].data[0x100], 2);
  assert.equal(img.sectors[1].data[0xff], 0xff);
  assert.equal(img.signed, null);
});

test('uf2ToFlashImage skips the RP2350-E10 absolute block and foreign families', () => {
  const p = new Uint8Array(256).fill(3);
  const img = uf2ToFlashImage(
    join(
      block(0x10ffff00, p, ABS),
      block(0x10000000, p, RP2350),
      block(0x10002000, p, RP2040)
    ),
    'RP2350'
  );
  assert.deepEqual(
    img.sectors.map((s) => s.addr),
    [0x10000000]
  );
  assert.equal(img.skippedBlocks, 2);
});

test('uf2ToFlashImage rejects RAM builds and files with nothing for the chip', () => {
  assert.throws(
    () =>
      uf2ToFlashImage(block(0x20000000, new Uint8Array(256), RP2040), 'RP2040'),
    /outside flash/
  );
  assert.throws(
    () =>
      uf2ToFlashImage(block(0x10000000, new Uint8Array(256), RP2040), 'RP2350'),
    /no blocks/
  );
});

function picobinBlock(items: number[][]): Uint8Array {
  const words = [
    0xffffded3,
    ...items.flat(),
    0x000003ff | (0 << 8),
    0,
    0xab123579,
  ];
  const b = new Uint8Array(words.length * 4);
  const v = new DataView(b.buffer);
  words.forEach((w, i) => v.setUint32(i * 4, w >>> 0, true));
  return b;
}

test('hasSignedImageDef finds a SIGNATURE item and ignores unsigned images', () => {
  const sector = (blk: Uint8Array) => {
    const d = new Uint8Array(0x1000).fill(0);
    d.set(blk, 0x40);
    return [{ addr: 0x10000000, data: d }];
  };
  // IMAGE_TYPE item: type 0x42, 1 word.
  const imageType = [0x00000142];
  // SIGNATURE item: type 0x09, 2 words (header + 1 payload word, enough for the walk).
  const signature = [0x00000209, 0xdeadbeef];
  assert.equal(hasSignedImageDef(sector(picobinBlock([imageType]))), false);
  assert.equal(
    hasSignedImageDef(sector(picobinBlock([imageType, signature]))),
    true
  );
});

test('decodeRpSecurity applies the 3-of-8 and 2-of-3 votes', () => {
  const raw = new Uint8Array(OTP_SECURITY_ROWS * 4);
  const v = new DataView(raw.buffer);
  // CRIT1: secure boot bit in 3 of 8 copies -> set; debug-disable in 2 -> not set.
  for (const r of [0, 3, 5]) v.setUint32(r * 4, 0x1, true);
  for (const r of [1, 2]) v.setUint32(r * 4, 0x4, true);
  // BOOT_FLAGS1 (rows 0x0b..0x0d): key 0 valid in 2 of 3, key 2 revoked in 1 of 3.
  v.setUint32(0x0b * 4, 0x001, true);
  v.setUint32(0x0c * 4, 0x401, true);
  const s = decodeRpSecurity(raw);
  assert.equal(s.secureBoot, true);
  assert.equal(s.debugDisabled, false);
  assert.deepEqual(s.validKeys, [0]);
  assert.deepEqual(s.revokedKeys, []);
});
