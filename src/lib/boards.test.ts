// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'vitest';
import { must } from './test-utils';
import assert from 'node:assert/strict';
import {
  LineBuffer,
  boardVerdict,
  bootHint,
  classifySerial,
  classifyUsb,
  dedupeBoards,
  describeTransition,
  logLevel,
  resetSteps,
  stripAnsi,
} from './boards';

const key = classifyUsb({
  vendorId: 0x2e8a,
  productId: 0x10fe,
  productName: 'Pico Key',
  hasWebCcid: true,
});
const bootUsb = classifyUsb({
  vendorId: 0x303a,
  productId: 0x1001,
  hasWebCcid: false,
});
const bootSer = classifySerial({ usbVendorId: 0x303a, usbProductId: 0x1001 });

test('classifies the devices seen on this machine', () => {
  assert.equal(key.kind, 'pico-key');
  assert.equal(key.usbId, '2E8A:10FE');
  assert.equal(bootUsb.kind, 'esp-bootloader');
  assert.equal(bootSer.kind, 'esp-bootloader');
  assert.equal(
    classifyUsb({ vendorId: 0x046d, productId: 0xc539 }).kind,
    'other'
  );
  assert.equal(classifySerial({}).kind, 'other');
});

test('USB and serial views of the same board are merged', () => {
  // Regression: the ESP USB-JTAG unit looks like WebCCID; it must stay a bootloader.
  const jtag = classifyUsb({
    vendorId: 0x303a,
    productId: 0x1001,
    productName: 'USB JTAG/serial debug unit',
    hasWebCcid: true,
  });
  assert.equal(jtag.kind, 'esp-bootloader');
  assert.equal(dedupeBoards([jtag, bootSer]).length, 1);
  assert.equal(
    boardVerdict([jtag, bootSer]).title,
    'ESP32 is in bootloader mode'
  );
  const merged = dedupeBoards([bootUsb, bootSer]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].via, 'USB + Serial');
});

test('verdicts', () => {
  assert.equal(boardVerdict([]).level, 'idle');
  assert.equal(boardVerdict([bootSer]).title, 'ESP32 is in bootloader mode');
  const rpBoot = classifyUsb({ vendorId: 0x2e8a, productId: 0x0003 });
  assert.equal(rpBoot.kind, 'rp-bootsel');
  assert.equal(rpBoot.label, 'RP2040 BOOTSEL');
  assert.equal(
    classifyUsb({ vendorId: 0x2e8a, productId: 0x000f }).label,
    'RP2350 BOOTSEL'
  );
  assert.equal(boardVerdict([rpBoot]).title, 'RP board is in BOOTSEL mode');
  assert.match(
    must(describeTransition([rpBoot], [key])).text,
    /flash succeeded/
  );
  assert.equal(boardVerdict([key]).title, 'Firmware is running');
  assert.equal(boardVerdict([key, bootSer]).level, 'warn');
});

test('transition from bootloader to running firmware reports success', () => {
  assert.match(
    must(describeTransition([bootSer], [key])).text,
    /flash succeeded/
  );
  assert.equal(must(describeTransition([key], [bootSer])).level, 'warn');
  assert.equal(describeTransition([key], [key]), null);
  assert.equal(describeTransition([], []), null);
});

test('LineBuffer handles LF, CRLF split across chunks, and lone CR', () => {
  const b = new LineBuffer();
  assert.deepEqual(b.push('ESP-ROM:esp32s3\r'), []);
  assert.deepEqual(b.push('\nrst:0x1 (POWERON)\n'), [
    'ESP-ROM:esp32s3',
    'rst:0x1 (POWERON)',
  ]);
  assert.deepEqual(b.push('a\rb\n'), ['a', 'b']);
  assert.deepEqual(b.push('partial'), []);
  assert.equal(b.pending, true);
  assert.equal(b.flush(), 'partial');
  assert.equal(b.pending, false);
});

test('ANSI colours and ESP-IDF log levels', () => {
  assert.equal(
    stripAnsi('\x1b[0;31mE (812) fido: boom\x1b[0m'),
    'E (812) fido: boom'
  );
  assert.equal(logLevel('E (812) fido: boom'), 'error');
  assert.equal(logLevel('W (5) x: y'), 'warn');
  assert.equal(logLevel('I (5) x: y'), 'info');
  assert.equal(logLevel("Guru Meditation Error: Core  0 panic'ed"), 'error');
  assert.equal(logLevel('plain text'), null);
});

test('boot hints for common ROM messages', () => {
  assert.match(must(bootHint('waiting for download')).text, /download mode/);
  assert.match(
    must(bootHint('boot:0x0 (DOWNLOAD(USB/UART0))')).text,
    /download mode/
  );
  assert.equal(must(bootHint('invalid header: 0xffffffff')).level, 'error');
  assert.match(must(bootHint('invalid header: 0x12345678')).text, /corrupt/);
  assert.match(must(bootHint('Brownout detector was triggered')).text, /power/);
  assert.equal(
    must(
      bootHint('rst:0x15 (USB_UART_CHIP_RESET),boot:0x8 (SPI_FAST_FLASH_BOOT)')
    ).level,
    'info'
  );
  assert.equal(bootHint('hello'), null);
});

test('reset sequences end with EN released and BOOT released', () => {
  for (const mode of ['run', 'download'] as const) {
    for (const usbJtag of [true, false]) {
      const steps = resetSteps(mode, { usbJtag });
      const last = steps[steps.length - 1];
      assert.equal(last.rts, false, `${mode}/${usbJtag}`);
      assert.equal(last.dtr, false, `${mode}/${usbJtag}`);
    }
  }
  assert.ok(
    resetSteps('download', { usbJtag: false }).some((s) => s.dtr && !s.rts)
  );
  assert.throws(() => resetSteps('nope' as 'run', { usbJtag: true }));
});
