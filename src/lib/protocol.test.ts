// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'vitest';
import { must } from './test-utils';
import assert from 'node:assert/strict';
import {
  APDU,
  CCID,
  buildCcid,
  parseCcidHeader,
  ccidCommandStatus,
  parseResponse,
  parseSelect,
  parseFlashInfo,
  parseSecureBoot,
  parsePhy,
  serializePhy,
  validatePhy,
  reviewPhy,
  diffPhy,
  emptyPhy,
  gpioRisk,
  fromHex,
  toHex,
  MCU,
  PHY_OPT,
  secureBootSlots,
} from './protocol';

const hex = (b: Uint8Array) => toHex(b, '');

test('rescue APDUs match the firmware command table', () => {
  assert.equal(hex(APDU.selectRescue()), '00A4040008A0583FC19B7E4F2100');
  assert.equal(hex(APDU.readPhy()), '801E010000');
  assert.equal(hex(APDU.readFlashInfo()), '801E020000');
  assert.equal(hex(APDU.readSecureBoot()), '801E030000');
  assert.equal(hex(APDU.writePhy(Uint8Array.of(0x06, 0x02, 0x00, 0x00))), '801C0100040602' + '0000');
  assert.equal(hex(APDU.enableSecureBoot(0, false)), '801D0000');
  assert.equal(hex(APDU.enableSecureBoot(2, true)), '801D0201');
});

test('CCID XfrBlock framing uses little-endian dwLength', () => {
  const apdu = new Uint8Array(300);
  const msg = buildCcid(CCID.PC_TO_RDR_XFR_BLOCK, 7, apdu);
  assert.equal(msg.length, 310);
  assert.deepEqual(Array.from(msg.slice(0, 10)), [0x6f, 0x2c, 0x01, 0, 0, 0, 7, 0, 0, 0]);
});

test('CCID response header parsing and status classes', () => {
  assert.equal(parseCcidHeader(new Uint8Array(9)), null);
  const ok = must(parseCcidHeader(Uint8Array.of(0x80, 2, 0, 0, 0, 0, 3, 0x00, 0, 0, 0x90, 0x00)));
  assert.equal(ok.length, 2);
  assert.equal(ok.seq, 3);
  assert.equal(ok.totalLength, 12);
  assert.equal(ccidCommandStatus(ok), 'ok');
  assert.equal(ccidCommandStatus({ status: 0x80 }), 'time-extension');
  assert.equal(ccidCommandStatus({ status: 0x42 }), 'failed');
  assert.equal(ccidCommandStatus({ status: 0x01 }), 'ok'); // ICC present-inactive is not an error
});

test('response APDU split', () => {
  const r = parseResponse(Uint8Array.of(1, 2, 0x69, 0x85));
  assert.deepEqual(Array.from(r.data), [1, 2]);
  assert.equal(r.sw, 0x6985);
  assert.throws(() => parseResponse(Uint8Array.of(0x90)));
});

test('SELECT response (8.x layout with build number)', () => {
  const data = Uint8Array.of(2, 2, 8, 0, 0x34, 0xb7, 0xda, 0x52, 0x95, 0x50, 0, 0, 0, 0, 0x01, 0x2c);
  const s = parseSelect(data);
  assert.equal(s.mcuName, 'ESP32-S3');
  assert.equal(s.productName, 'Pico FIDO');
  assert.equal(s.version, '8.0');
  assert.equal(s.serialHex, '34B7DA5295500000');
  assert.equal(s.serialDecimal, ((0x34 & 0x03) << 24 | 0xb7 << 16 | 0xda << 8 | 0x52) >>> 0);
  assert.equal(s.build, 300);
  assert.equal(parseSelect(data.slice(0, 12)).build, null); // 7.x layout
});

test('flash info and secure boot status', () => {
  const f = parseFlashInfo(fromHex('00010000 00002000 00012000 0000000A 00400000'));
  assert.deepEqual(f, { free: 0x10000, used: 0x2000, total: 0x12000, files: 10, chipSize: 0x400000, firmwareSize: null });
  assert.deepEqual(parseSecureBoot(Uint8Array.of(1, 0, 0)), { enabled: true, locked: false, bootKey: 0 });
  assert.deepEqual(parseSecureBoot(Uint8Array.of(0, 0, 0xff)), { enabled: false, locked: false, bootKey: null });
});

// Record as firmware phy_serialize_data would emit it for the ESP32-S3-Zero setup.
const ZERO_RECORD = fromHex(
  [
    '00 04 1D50 619B', // VID:PID
    '04 01 15', // LED GPIO 21
    '05 01 0F', // brightness 15
    '06 02 000A', // DIMM | STEADY
    '08 01 0F', // button timeout 15 s
    '09 08 5069636F4B657900', // "PicoKey\0"
    '0A 04 0000008F', // curves
    '0B 01 1F', // all interfaces
    '0C 02 05 02', // NeoPixel, GRB
  ].join(''),
);

test('PHY parse matches firmware field layout', () => {
  const { config: c, truncated } = parsePhy(ZERO_RECORD);
  assert.equal(truncated, false);
  assert.equal(c.vid, 0x1d50);
  assert.equal(c.pid, 0x619b);
  assert.equal(c.ledGpio, 21);
  assert.equal(c.ledBrightness, 15);
  assert.equal(c.opts, PHY_OPT.DIMM | PHY_OPT.LED_STEADY);
  assert.equal(c.upBtn, 15);
  assert.equal(c.usbProduct, 'PicoKey');
  assert.equal(c.curves, 0x8f);
  assert.equal(c.usbItf, 0x1f);
  assert.equal(c.ledDriver, 5);
  assert.equal(c.ledOrder, 2);
});

test('PHY serialize is byte-identical to firmware order (round trip)', () => {
  const { config } = parsePhy(ZERO_RECORD);
  assert.equal(hex(serializePhy(config)), hex(ZERO_RECORD));
});

test('PHY serialize of empty config emits only OPTS, like firmware', () => {
  assert.equal(hex(serializePhy(emptyPhy())), '06020000');
});

test('PHY driver tag without order stays 1 byte', () => {
  const c = { ...emptyPhy(), ledDriver: 5 };
  assert.equal(hex(serializePhy(c)), '06020000' + '0C0105');
});

test('unknown tags are preserved through a round trip', () => {
  const rec = fromHex('0602 0000 0F 03 414243');
  const { config } = parsePhy(rec);
  assert.equal(config.unknown.length, 1);
  assert.equal(hex(serializePhy(config)), hex(rec));
});

test('malformed / truncated records do not throw', () => {
  assert.equal(parsePhy(fromHex('04 05 15')).truncated, true);
  assert.equal(parsePhy(fromHex('06 02 00 00 04')).truncated, true);
  // wrong-length known tag is ignored, not misread
  const { config } = parsePhy(fromHex('04 02 15 16'));
  assert.equal(config.ledGpio, null);
});

test('validation rejects out-of-range values', () => {
  assert.ok(validatePhy({ ...emptyPhy(), ledBrightness: 16 }).length);
  assert.ok(validatePhy({ ...emptyPhy(), vid: 0x1234 }).length); // PID missing
  assert.ok(validatePhy({ ...emptyPhy(), usbProduct: 'x'.repeat(32) }).length);
  assert.ok(validatePhy({ ...emptyPhy(), usbProduct: 'caf\u00e9' }).length);
  assert.ok(validatePhy({ ...emptyPhy(), usbItf: 0 }).length);
  assert.ok(validatePhy({ ...emptyPhy(), ledOrder: 1 }).length); // order without driver
  assert.ok(validatePhy({ ...emptyPhy(), ledDriver: 0x42 }).length);
  assert.deepEqual(validatePhy({ ...emptyPhy(), usbProduct: 'x'.repeat(31) }), []);
  assert.throws(() => serializePhy({ ...emptyPhy(), ledGpio: 300 }));
});

test('GPIO safety rules for ESP32-S3', () => {
  assert.equal(gpioRisk(MCU.ESP32S3, 21), null);
  assert.equal(gpioRisk(MCU.ESP32S3, 48), null);
  assert.equal(must(gpioRisk(MCU.ESP32S3, 19)).level, 'block');
  assert.equal(must(gpioRisk(MCU.ESP32S3, 20)).level, 'block');
  assert.equal(must(gpioRisk(MCU.ESP32S3, 27)).level, 'block');
  assert.equal(must(gpioRisk(MCU.ESP32S3, 0)).level, 'block');
  assert.equal(must(gpioRisk(MCU.ESP32S3, 49)).level, 'block');
  assert.equal(must(gpioRisk(MCU.ESP32S3, 46)).level, 'warn');
});

test('review blocks dangerous writes and warns on lock-out risks', () => {
  const before = parsePhy(ZERO_RECORD).config;
  assert.deepEqual(reviewPhy(before, before, MCU.ESP32S3), { errors: [], warnings: [] });

  const usbPin = { ...before, ledGpio: 20 };
  assert.ok(reviewPhy(before, usbPin, MCU.ESP32S3).errors.length);

  const rpDriver = { ...before, ledDriver: 0x03, ledOrder: null };
  assert.ok(reviewPhy(before, rpDriver, MCU.ESP32S3).errors.length);

  const noWeb = { ...before, usbItf: 0x1f & ~0x02 };
  assert.match(reviewPhy(before, noWeb, MCU.ESP32S3).warnings.join(), /WebCCID/);

  const newVid = { ...before, vid: 0x1234, pid: 0x5678 };
  assert.match(reviewPhy(before, newVid, MCU.ESP32S3).warnings.join(), /VID\/PID/);

  const noPress = { ...before, upBtn: null };
  assert.match(reviewPhy(before, noPress, MCU.ESP32S3).warnings.join(), /BOOT-button/);
  assert.deepEqual(reviewPhy(noPress, { ...noPress, upBtn: 0 }, MCU.ESP32S3).warnings, []);
});

test('diff lists only changed fields', () => {
  const before = parsePhy(ZERO_RECORD).config;
  const after = { ...before, ledGpio: 48, ledBrightness: 8 };
  assert.deepEqual(diffPhy(before, after), [
    ['LED GPIO', '21', '48'],
    ['LED brightness', '15/15', '8/15'],
  ]);
});

test('secure boot slot counts per MCU', () => {
  assert.equal(secureBootSlots(MCU.ESP32S3), 3);
  assert.equal(secureBootSlots(MCU.RP2350), 4);
  assert.equal(secureBootSlots(MCU.RP2040), null);
});
