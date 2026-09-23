# Keyzforge firmware

The FIDO2 firmware that runs on every Keyzforge key, built in the open from this directory. Nothing is hidden: the exact
source, the patches, the toolchain image and the CI that publishes each release all live here. Fork it and build your own key.

It is based on the open-source [pico-fido](https://github.com/polhenarejos/pico-fido) code base by Pol Henarejos (AGPL-3.0),
pinned as a submodule, with Keyzforge changes kept as small, reviewable patches.

```
firmware/
├── pico-fido/      upstream source, pinned git submodule (v8.0, includes pico-keys-sdk)
├── patches/        Keyzforge changes, applied in order at build time
│   ├── 0001-build-time-config-header.patch   build options (passkey slots, ...)
│   └── 0002-usb-strings-keyforge.patch       USB name: Keyzforge / Keyzforge Key
├── build.sh        one script for every board, used by CI and by you
├── Dockerfile      ESP-IDF 5.5.1 + Arm GCC + pico-sdk 2.1.1 + picotool
├── VERSION         label for release file names
├── NOTICE.md       release notes and license text attached to every release
└── ARCHITECTURE.md map of the firmware code: where to change what
```

## Build it

You need Docker, or Linux/macOS/WSL with the toolchains below.

```sh
git clone --recursive https://github.com/SamieTheCoder/keyzforge
cd keyforge
docker build -t keyforge-fw firmware
docker run --rm -v "$PWD:/src" -w /src keyforge-fw firmware/build.sh pico pico2 esp32s3 esp32s2
ls firmware/dist      # .uf2 / .bin files and SHA256SUMS
```

Without Docker: install ESP-IDF 5.5 and `source export.sh` for ESP boards, or set `PICO_SDK_PATH` to pico-sdk 2.1.1
for RP boards, then run `firmware/build.sh <board>`.

| Board argument | Output |
| --- | --- |
| `pico`, `pico2` | Raspberry Pi Pico (RP2040) and Pico 2 (RP2350) |
| any pico-sdk board, e.g. `waveshare_rp2040_zero`, `adafruit_qtpy_rp2040` | UF2 for that board's pinout and flash size |
| `esp32s3`, `esp32s2` | merged image, flash at 0x0 |

Flash the result at [keyzforge.xyz/flash](https://keyzforge.xyz/flash) with "Or use a local file".

## Customise it

Options are environment variables for `build.sh`:

| Variable | Default | What it does |
| --- | --- | --- |
| `MAX_RESIDENT_CREDENTIALS` | 256 | Passkey slots. 256 is the ceiling: passkeys use file IDs 0xCF00 to 0xCFFF. |
| `ENABLE_OATH_APP` | 1 | TOTP/HOTP applet. |
| `ENABLE_OTP_APP` | 1 | Yubico-style OTP slots. Keyzforge's Configure and Passkeys pages need OATH or OTP on, because together they switch on the USB smart-card interface. |
| `ENABLE_POWER_ON_RESET` | upstream | Power-cycle behaviour on reset. |
| `SECURE_BOOT_PKEY` | unset | Sign RP2350 images with your own P-256 key (PEM). Keep it out of git. |
| `VERSION` | `firmware/VERSION` | Label in file names. |

```sh
# A key with 64 passkey slots and no OTP applet, for a Waveshare RP2040-Zero
docker run --rm -v "$PWD:/src" -w /src \
  -e MAX_RESIDENT_CREDENTIALS=64 -e ENABLE_OTP_APP=0 \
  keyforge-fw firmware/build.sh waveshare_rp2040_zero
```

### Add your own change

1. Edit files under `firmware/pico-fido/`.
2. Save the change as a patch and undo it in the submodule:
   ```sh
   git -C firmware/pico-fido diff > firmware/patches/0002-my-change.patch
   git -C firmware/pico-fido checkout -- .
   ```
3. Run `build.sh`. Patches are applied in file-name order to a scratch copy, so the submodule stays clean.

### Update upstream

```sh
git -C firmware/pico-fido fetch --tags && git -C firmware/pico-fido checkout v8.1
git -C firmware/pico-fido submodule update --init --recursive
echo 8.1-kf1 > firmware/VERSION
git -C firmware/pico-fido apply --check ../patches/*.patch   # fix any patch that no longer applies
```

## Things to know before you flash your own build

- **Secure boot.** "Enable secure boot" in Keyzforge burns the PicoKeys release key. After that only PicoKeys-signed
  firmware boots, so your build would not. On RP2350 you can sign with your own key via `SECURE_BOOT_PKEY`, but
  Keyzforge does not burn custom keys; use `picotool otp` for that, and only when you understand it is permanent.
- **USB IDs.** Builds report as **Keyzforge Key** by Keyzforge, but keep the upstream USB ID (2E8A:10FE) so existing tools
  and drivers keep working. `pico-fido/pico-fido-patch-vidpid.sh` changes it on a built image. Use an ID you are allowed
  to use (for example a free one from pid.codes).
- **Passkeys survive** reflashing the same firmware family, but always keep another way into your accounts.

## Releases

`.github/workflows/firmware.yml` builds every board when a push or pull request touches `firmware/` (or the workflow
file itself). That path filter is why the workflow runs on some commits and skips others: site-only changes in `src/`
or docs never trigger a firmware build. Running it by hand with **publish** ticked creates the release `fw-<VERSION>`
with the binaries, `SHA256SUMS`, `NOTICE.md` and the complete source tarball. Keyzforge's flasher lists those releases
as **Keyzforge builds**.

## License

pico-fido and pico-keys-sdk: Copyright (c) Pol Henarejos, AGPL-3.0. Keyzforge patches and scripts: AGPL-3.0. If you
distribute builds, publish their source too; the release workflow does this for you.
