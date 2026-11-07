# Four-bar editor regression — 7 November 2026

These screenshots were captured from the production container during the creator
regression in `spec/browser/creative.pw.ts`, after selecting four bars and switching
8 → 16 → 8 → 16 without changing source. They show the grid remains available
instead of the former '64 steps, more than the grid’s 32' dead end.

- [Phone, 390×844](grid-four-bars-phone.png)
- [Desktop, 1920×1080](grid-four-bars-desktop.png)

The grid has its own horizontal scrolling area. The browser test also clicks a
cell in the final bar, checks the exact draft, undoes it and returns to one bar.
The screenshots illustrate layout; the test assertions establish source
preservation, focus, final-bar editing and recovery. They do not establish human
usability or musical quality.
