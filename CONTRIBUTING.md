# Contributing to Keyzforge

Thanks for helping. Keyzforge is a community project: a web app and an open firmware for FIDO2 security keys that anyone can
build from a cheap board. Every fix, board profile, translation and test makes keys cheaper and safer for more people.

There are two halves, and you can work on either without touching the other:

| Part | Where | Language | You need |
| --- | --- | --- | --- |
| Web app | `src/` | TypeScript, React, Next.js | Node 20.9+ and a Chromium browser |
| Firmware | `firmware/` | C (ESP-IDF, pico-sdk) | Docker, or the toolchains in `firmware/Dockerfile` |

## Good first contributions

- **Board profiles.** Add your board's LED pin and driver to `BOARD_PRESETS` in `src/lib/protocol.ts`, with the board name and a
  link to its pinout. Please test it on the real board.
- **Boot-log hints.** If the serial monitor showed a message it did not explain, add a rule to `bootHint` in `src/lib/boards.ts`
  with a test in `src/lib/boards.test.ts`.
- **Translations.** The README is in English and Hindi. More Indian languages are very welcome (`README.<code>.md`).
- **Firmware options.** A new build option in `firmware/build.sh`, documented in `firmware/README.md`.
- **Docs.** If something confused you, it will confuse the next person. Fix the words.

Look for issues labelled `good first issue` or `help wanted`, or open one to discuss an idea first.

## Set up

```sh
git clone --recursive https://github.com/SamieTheCoder/keyzforge
cd keyforge
npm ci
npm run dev          # http://localhost:3000 (WebUSB and Web Serial work on localhost)
```

Firmware:

```sh
docker build -t keyforge-fw firmware
docker run --rm -v "$PWD:/src" -w /src keyforge-fw firmware/build.sh pico     # or pico2, esp32s3, esp32s2
```

Read [`firmware/ARCHITECTURE.md`](firmware/ARCHITECTURE.md) for a map of the firmware code.

## Before you open a pull request

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

CI runs the same steps, and builds every firmware target when `firmware/` changes.

- **One change per pull request.** Smaller PRs are reviewed faster.
- **Tests for logic.** Protocol encoders and parsers in `src/lib` are pure functions with tests next to them. Keep it that way.
- **Hardware changes say what you tested on**: board, chip, firmware version, browser and OS.
- **Firmware changes are patches.** Do not commit edits inside `firmware/pico-fido/`. Make the change there, save it with
  `git -C firmware/pico-fido diff > firmware/patches/NNNN-short-name.patch`, revert the submodule, and commit the patch.
- **Commit messages** in the imperative: "Add Waveshare RP2040-Zero LED preset", not "added preset".

## Style

- TypeScript strict, Prettier (single quotes, 2 spaces), ESLint flat config. `npm run format` fixes most of it.
- UI text is plain and short. No em dashes in visible text. One accent colour. Both themes and reduced motion must work.
- Icons from Phosphor only. Illustrations from hairline only.
- Never send a key's data anywhere. Everything about the user's hardware stays in the browser tab.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [GNU AGPL-3.0](LICENSE), the license of this project.
The firmware code base is AGPL-3.0 as well; keep existing copyright headers in any file you change.

## Conduct

Be kind. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
