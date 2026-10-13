# Dependencies and audio

Stream uses the following libraries; exact releases are pinned in `pnpm-lock.yaml`:

- Strudel core and mini-notation 1.2.6 — AGPL-3.0-or-later, [Strudel](https://strudel.cc/), [source](https://codeberg.org/uzu/strudel).
- Blockly 13.3.0 — Apache-2.0, [Blockly](https://docs.blockly.com/), [source](https://github.com/google/blockly).
- Acorn 8.19.0 — MIT, [source](https://github.com/acornjs/acorn).
- Vite, Vitest, Playwright and axe are build/test tools; their notices ship with their packages.

The bundled browser code uses Strudel's pattern engine. Stream's bounded native WebAudio output synthesises kick, snare, hi-hat and clap from oscillators and seeded noise; it does not download sample recordings. Note instruments use the browser's oscillator waveforms. `client/audio.ts` implements gain envelopes, low-pass filtering, a short generated reverb impulse and a final compressor.

The library licences and copyright notices remain with the installed packages. The application source is distributed under AGPL-3.0-or-later; see `LICENSE`. A network distribution must provide its corresponding source. The source-repository link in the app provides access to the project and its dependency lockfile.

These four simple drum voices are Stream's output instruments, not claims to reproduce the sounds of Strudel's default sample bank exactly. Exported expressions can sound different in another Strudel environment using different sound banks.
