# Third-party notices

Keyforge is licensed under AGPL-3.0-only (see `LICENSE`). It includes or is derived from the following work.

## picoflash (MIT)

`src/lib/picoboot.ts` follows the PICOBOOT command layout and USB sequencing of picoflash.
https://github.com/piersfinlayson/picoflash

```
MIT License

Copyright (c) 2025 Piers Finlayson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pico-fido and pico-keys-sdk (AGPL-3.0)

The rescue applet, PHY record and FIDO-over-CCID wire formats in `src/lib/protocol.ts`, `src/lib/webusb.ts` and
`src/lib/ctap.ts` were implemented from the pico-fido and pico-keys-sdk sources by Pol Henarejos.
https://github.com/polhenarejos/pico-fido, https://github.com/polhenarejos/pico-keys-sdk

Firmware is not bundled with the website. "Keyforge builds" are compiled from unmodified pico-fido source by
`.github/workflows/firmware.yml` and published as releases of this repository, each with the complete corresponding
source attached. The official and LibreKeys builds are downloaded on demand from their own releases, where their
source is published:
https://github.com/polhenarejos/pico-fido/releases, https://github.com/librekeys/pico-fido-firmwares/releases

## esptool-js (Apache-2.0)

ESP32 flashing uses the esptool-js npm package by Espressif Systems. https://github.com/espressif/esptool-js

## hairline (MIT)

The line drawings use the @lucasmarkes/hairline npm package by Lucas Marques. https://github.com/lucasmarkes/hairline

## Phosphor Icons (MIT), Geist (SIL OFL 1.1)

Icons from @phosphor-icons/react; fonts from the geist package by Vercel.

## Trademarks

Raspberry Pi, RP2040 and RP2350 are trademarks of Raspberry Pi Ltd. ESP32 is a trademark of Espressif Systems. FIDO is
a trademark of the FIDO Alliance. Pico Keys and pico-fido belong to their author. Keyforge is an independent project and
is not affiliated with, endorsed or certified by any of them.
