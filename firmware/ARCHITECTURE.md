# Firmware architecture

A map of the firmware code for people who want to change it. Paths are inside `firmware/pico-fido/` (the pinned source).
Never edit them in place for a pull request: make the change, save it as a patch in `firmware/patches/` (see
[README.md](README.md#add-your-own-change)).

## Layers

```
 USB host (browser, OS, passkey apps)
        │
 ┌──────┴──────────────────────────────────────────────────────────────────┐
 │ pico-keys-sdk/src/usb        TinyUSB descriptors and interfaces          │
 │   hid/  CTAP HID (FIDO)      ccid/  smart card (CCID + WebCCID)          │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ pico-keys-sdk/src/apdu.c     APDU routing to applets by AID              │
 │ pico-keys-sdk/src/rescue.c   rescue applet: device info, PHY, secure boot│
 ├──────────────────────────────────────────────────────────────────────────┤
 │ src/fido                     FIDO2 / U2F applet, OATH, OTP               │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ pico-keys-sdk/src/fs         flash file system (files by 16-bit ID)      │
 │ pico-keys-sdk/src/otp        eFuse / OTP: device keys, secure boot       │
 │ led/ button.c rng/ crypto    board services                              │
 └──────────────────────────────────────────────────────────────────────────┘
        │
 ESP-IDF (ESP32-S3, S2)  or  pico-sdk (RP2040, RP2350)
```

## FIDO applet (`src/fido`)

| File | What it does |
| --- | --- |
| `fido.c`, `fido.h` | Applet entry, init, key derivation, user presence, the `MAX_*` limits |
| `cbor.c` | CTAP2 command dispatch (`cbor_parse`), shared by HID and CCID |
| `cbor_make_credential.c` | `authenticatorMakeCredential`: create a passkey |
| `cbor_get_assertion.c` | `authenticatorGetAssertion`: sign in |
| `cbor_client_pin.c` | PIN set / change / tokens (PIN protocols 1 and 2) |
| `cbor_cred_mgmt.c` | Credential management: storage info, list, delete (used by Keyzforge Passkeys) |
| `cbor_get_info.c` | `authenticatorGetInfo`: versions, options, AAGUID, limits |
| `cbor_config.c`, `cbor_reset.c`, `cbor_selection.c`, `cbor_large_blobs.c` | Config, reset, selection, large blobs |
| `cbor_vendor.c`, `vault.c` | Vendor commands |
| `credential.c`, `resident_container.c` | Credential encoding, encryption and resident storage |
| `cmd_register.c`, `cmd_authenticate.c`, `cmd_version.c` | U2F / CTAP1 |
| `oath.c`, `oath_container.c` | TOTP / HOTP applet |
| `otp.c`, `otp_container.c` | Yubico-style OTP slots |
| `files.c`, `files.h` | File IDs: PIN `0x1080`, passkeys `0xCF00`-`0xCFFF`, sites `0xD000`-`0xD0FF` |
| `known_apps.c` | Friendly names for well-known relying parties |
| `version.h` | Firmware version reported to hosts |

## SDK (`pico-keys-sdk/src`)

| Path | What it does |
| --- | --- |
| `main.c` | Boot, task loop, applies the PHY record (USB IDs, product name) |
| `usb/usb_descriptors.c` | USB device, interface and string descriptors (patched by `0002`) |
| `usb/hid`, `usb/ccid` | CTAP HID transport and CCID / WebCCID transport |
| `apdu.c`, `tlv.c` | APDU parsing and TLV helpers |
| `rescue.c` | Rescue applet that Keyzforge Configure talks to: info, PHY read / write, secure boot |
| `fs/phy.c`, `fs/phy.h` | PHY record: LED pin / driver / order / brightness, USB IDs, interfaces, options |
| `fs/file.c`, `fs/flash.c`, `fs/low_flash.c` | Flash-backed file system with wear handling |
| `otp/otp_*.c` | Per-platform eFuse / OTP access and secure boot enable / lock |
| `led/led_*.c` | LED drivers: GPIO, WS2812 / NeoPixel, Pimoroni, CYW43 |
| `button.c` | BOOT button as user presence |
| `rng/`, `crypto_utils.c` | Hardware RNG and crypto helpers on top of mbedTLS |

## Where to make common changes

| I want to | Change |
| --- | --- |
| Fewer passkey slots | `MAX_RESIDENT_CREDENTIALS=64 firmware/build.sh ...` (patch `0001`, max 256) |
| Default USB product name | `usb/usb_descriptors.c` string 2 (patch `0002`); per key, use Configure instead |
| A new board's LED | Usually no firmware change: set pin and driver in Configure |
| Drop OATH or OTP | `ENABLE_OATH_APP=0` / `ENABLE_OTP_APP=0` (keep one on for Configure and Passkeys) |
| A new vendor command | `src/fido/cbor_vendor.c`, then call it from `src/lib` in the web app |
| Different GetInfo values | `src/fido/cbor_get_info.c` |

## Test without hardware

The code base builds a host emulator (`-DENABLE_EMULATION=1`) used by its Python test suite in `firmware/pico-fido/tests`.
On Linux:

```sh
cmake -S firmware/pico-fido -B build-emu -DENABLE_EMULATION=1 && cmake --build build-emu -j
```

## Licence

All files here are AGPL-3.0. Keep the copyright header of any file you patch, and add your own line if your change is
substantial.
