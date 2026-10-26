# Dependencies and audio

Ensemble uses the following libraries; exact releases are pinned in `pnpm-lock.yaml`:

- Strudel core and mini-notation 1.2.6 — AGPL-3.0-or-later, [Strudel](https://strudel.cc/), [source](https://codeberg.org/uzu/strudel).
- Acorn 8.19.0 — MIT, [source](https://github.com/acornjs/acorn).
- Vite, Vitest, Playwright, jsdom and axe are build/test tools; their notices ship with their packages.

The bundled browser code uses Strudel's pattern engine. Ensemble's bounded native WebAudio output synthesises kick, snare, hi-hat and clap from oscillators and seeded noise; it does not download sample recordings. Note instruments use the browser's oscillator waveforms. `client/audio.ts` implements gain envelopes, release, low-pass filtering, stereo pan, a generated reverb impulse, and a fixed master gain into a limiter.

The performers are original SVG drawings made for Ensemble (`client/performer.ts`). The preset patterns in `shared/presets.ts` are original. No Incredibox audio, artwork, characters or arrangements are used; Incredibox is cited only as the interaction reference.

The library licences and copyright notices remain with the installed packages. The application source is distributed under AGPL-3.0-or-later; see `LICENSE`. A network distribution must provide its corresponding source. The source-repository link in the app provides access to the project and its dependency lockfile.

These four simple drum voices are Ensemble's output instruments, not claims to reproduce the sounds of Strudel's default sample bank exactly. Exported expressions can sound different in another Strudel environment using different sound banks.
