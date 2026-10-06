// The grid is a view over one exact subset of Strudel code: a single
// `s("...")` call, one sound name (or `~` for a rest) per step. Nothing wider
// than that is attempted --- see spec/pattern.test.ts and the stream brief for
// why. `parse` turns a code string into that shape or returns null; `print`
// turns it back into the exact string a grid produces. The round trip
// `parse(print(x)) === x` is the one promise this file makes.

export type Pattern = {
  // One entry per step. A sound name, or null for a rest (`~`).
  steps: (string | null)[];
};

// A sound name: Strudel's own token rule is looser than this, but the grid
// only ever writes names in this shape, so this is the subset it also reads
// back. Anything else in a step falls outside the subset entirely.
const SOUND = /^[a-zA-Z][a-zA-Z0-9]*$/;

const LINE = /^s\("([^"<>]*)"\)$/;

export function parse(code: string): Pattern | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;
  if (trimmed.includes("\n")) return null;

  const match = LINE.exec(trimmed);
  if (!match) return null;

  const inner = match[1];
  if (inner.length === 0) return null;

  const tokens = inner.split(/\s+/);
  const steps: (string | null)[] = [];
  for (const token of tokens) {
    if (token === "~") {
      steps.push(null);
    } else if (SOUND.test(token)) {
      steps.push(token);
    } else {
      return null;
    }
  }
  return { steps };
}

export function print(pattern: Pattern): string {
  const body = pattern.steps.map((step) => (step === null ? "~" : step)).join(" ");
  return `s("${body}")`;
}
