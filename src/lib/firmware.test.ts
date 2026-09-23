// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'vitest';
import { must } from './test-utils';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  bootDriveChip,
  inspectEspImage,
  matchAssets,
  md5Hex,
  normaliseChip,
  parseUf2,
  planEspFlash,
  planUf2Copy,
  UF2,
  uf2HintFromName,
} from './firmware';

function espImage(
  chipId: number,
  { pad = 0, size = 128 * 1024 } = {}
): Uint8Array {
  const b = new Uint8Array(size).fill(0xff, 0, pad);
  const h = b.subarray(pad);
  h[0] = 0xe9;
  h[1] = 3;
  h[2] = 2; // DIO
  h[3] = 0x20; // 4MB
  h[12] = chipId & 0xff;
  h[13] = chipId >> 8;
  return b;
}

function uf2(families: number[]): Uint8Array {
  const out = new Uint8Array(families.length * 512);
  const dv = new DataView(out.buffer);
  families.forEach((fam, i) => {
    const o = i * 512;
    dv.setUint32(o, UF2.MAGIC0, true);
    dv.setUint32(o + 4, UF2.MAGIC1, true);
    dv.setUint32(o + 8, UF2.FLAG_FAMILY, true);
    dv.setUint32(o + 12, 0x10000000 + i * 256, true);
    dv.setUint32(o + 16, 256, true);
    dv.setUint32(o + 20, i, true);
    dv.setUint32(o + 24, families.length, true);
    dv.setUint32(o + 28, fam, true);
    dv.setUint32(o + 508, UF2.MAGIC_END, true);
  });
  return out;
}

test('ESP image header: merged ESP32-S3 image', () => {
  const info = must(inspectEspImage(espImage(0x0009)));
  assert.equal(info.chip, 'ESP32-S3');
  assert.equal(info.offset, 0);
  assert.equal(info.flashMode, 'DIO');
  assert.equal(info.flashSize, '4MB');
});

test('ESP image header: padded ESP32 classic image and non-images', () => {
  assert.equal(
    must(inspectEspImage(espImage(0x0000, { pad: 0x1000 }))).offset,
    0x1000
  );
  assert.equal(inspectEspImage(new Uint8Array(4096)), null);
  assert.equal(inspectEspImage(uf2([0xe48bff56])), null);
});

test('flash plan rejects wrong chip and non-images', () => {
  assert.deepEqual(
    planEspFlash(
      inspectEspImage(espImage(9)),
      'ESP32-S3 (QFN56) (revision v0.2)'
    ).errors,
    []
  );
  assert.equal(
    planEspFlash(inspectEspImage(espImage(9)), 'ESP32-S3').address,
    0
  );
  assert.match(
    planEspFlash(inspectEspImage(espImage(2)), 'ESP32-S3').errors[0],
    /built for ESP32-S2/
  );
  assert.equal(planEspFlash(null, 'ESP32-S3').errors.length, 1);
  assert.equal(normaliseChip('ESP32-S2FH4 (revision v0.0)'), 'ESP32-S2');
  assert.equal(normaliseChip('ESP32-D0WD-V3'), 'ESP32');
});

test('UF2 parsing identifies RP2040 and RP2350 images', () => {
  assert.equal(parseUf2(uf2([0xe48bff56, 0xe48bff56])).target, 'RP2040');
  const rp2350 = parseUf2(uf2([0xe48bff57, 0xe48bff59, 0xe48bff59]));
  assert.equal(rp2350.target, 'RP2350');
  assert.equal(rp2350.blocks, 3);
  assert.equal(rp2350.payload, 768);
  assert.throws(() => parseUf2(new Uint8Array(500)), /multiple of 512/);
  const bad = uf2([0xe48bff56]);
  bad[0] = 0;
  assert.throws(() => parseUf2(bad), /bad magic/);
});

test('boot drive detection and UF2 copy plan', () => {
  assert.equal(
    bootDriveChip(
      'UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n'
    ),
    'RP2040'
  );
  assert.equal(
    bootDriveChip(
      'UF2 Bootloader v1.0\nModel: Raspberry Pi RP2350\nBoard-ID: RP2350\n'
    ),
    'RP2350'
  );
  const info = parseUf2(uf2([0xe48bff59]));
  assert.match(planUf2Copy(info, 'RP2040').errors[0], /for RP2350/);
  assert.deepEqual(planUf2Copy(info, 'RP2350').errors, []);
});

test('release asset matching per target', () => {
  const releases = [
    {
      tag_name: 'nightly-main',
      assets: [
        { name: 'pico_fido_esp32-s2.bin', size: 1, browser_download_url: 'u1' },
        { name: 'pico_fido_esp32-s3.bin', size: 2, browser_download_url: 'u2' },
        { name: 'pico_fido_pico-8.0.uf2', size: 3, browser_download_url: 'u3' },
        {
          name: 'pico_fido_pico2-8.0.uf2',
          size: 4,
          browser_download_url: 'u4',
        },
      ],
    },
  ];
  assert.deepEqual(
    matchAssets(releases, 'esp32-s3').map((a) => a.name),
    ['pico_fido_esp32-s3.bin']
  );
  const uf2s = matchAssets(releases, 'rp2350');
  // Regression: the RP2040 file (pico_fido_pico-8.0.uf2) used to be offered for RP2350.
  assert.deepEqual(
    uf2s.map((a) => a.name),
    ['pico_fido_pico2-8.0.uf2']
  );
  assert.equal(uf2s[0].hint, 'RP2350');
  assert.equal(uf2s[0].prerelease, true);
  assert.deepEqual(
    matchAssets(releases, 'rp2040').map((a) => a.name),
    ['pico_fido_pico-8.0.uf2']
  );
  assert.deepEqual(matchAssets(releases, 'nope' as 'rp2040'), []);
});

test('uf2HintFromName handles official, Keyforge and LibreKeys names', () => {
  assert.equal(uf2HintFromName('pico_fido_pico-8.0.uf2'), 'RP2040');
  assert.equal(uf2HintFromName('pico_fido_pico2-8.0.uf2'), 'RP2350');
  assert.equal(uf2HintFromName('keyforge-fido_pico-8.0.uf2'), 'RP2040');
  assert.equal(uf2HintFromName('keyforge-fido_pico2-8.0.uf2'), 'RP2350');
  assert.equal(
    uf2HintFromName('pico-fido2-adafruit_feather_rp2040.uf2'),
    'RP2040'
  );
  assert.equal(
    uf2HintFromName('pico-fido2-adafruit_feather_rp2350-eddsa.uf2'),
    'RP2350'
  );
  assert.equal(uf2HintFromName('pico-fido2-0xcb_helios.uf2'), null);
});

test('MD5 matches Node crypto on standard vectors and odd lengths', () => {
  assert.equal(md5Hex(new Uint8Array(0)), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(
    md5Hex(new TextEncoder().encode('abc')),
    '900150983cd24fb0d6963f7d28e17f72'
  );
  for (const n of [55, 56, 63, 64, 65, 1000, 100003]) {
    const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
    assert.equal(
      md5Hex(b),
      createHash('md5').update(b).digest('hex'),
      `len ${n}`
    );
  }
});
