Keyzforge firmware @VERSION@, built by GitHub Actions from this repository's `firmware/` directory:
[pico-fido](https://github.com/polhenarejos/pico-fido) at commit `@COMMIT@` plus the patches in
`firmware/patches`, Keyzforge commit `@KEYFORGE@`. Build log: @RUN@

| File | Board |
| --- | --- |
| `keyforge-fido_esp32-s3-@VERSION@.bin` | ESP32-S3 (full image, flash at 0x0) |
| `keyforge-fido_esp32-s2-@VERSION@.bin` | ESP32-S2 (full image, flash at 0x0) |
| `keyforge-fido_pico-@VERSION@.uf2` | RP2040 (Raspberry Pi Pico and compatibles) |
| `keyforge-fido_pico2-@VERSION@.uf2` | RP2350 (Raspberry Pi Pico 2 and compatibles) |

Check downloads against `SHA256SUMS`, then flash them in the browser at https://keyzforge.xyz/flash.

**Secure boot.** These builds are not signed with the PicoKeys release key. They run normally, but do not
enable secure boot on a key running them: it burns the PicoKeys key into the chip and these builds would stop
booting. Use the official pico-fido release if you need secure boot.

**Build your own.** Everything used to make these files is in `firmware/` (see `firmware/README.md`).

**License.** pico-fido and pico-keys-sdk are Copyright (c) Pol Henarejos, licensed under the GNU Affero General
Public License v3.0. The Keyzforge patches and build scripts are AGPL-3.0 too. The complete corresponding source,
including all submodules, is attached as `keyforge-fido-@VERSION@-source.tar.gz`.

Keyzforge is an independent project, not affiliated with or endorsed by PicoKeys, Espressif or Raspberry Pi.
