// Protects src/pattern.ts: the grid is a view over one exact subset of
// Strudel code, and parse(print(x)) === x is the one promise it makes. See
// the stream brief for why this is deliberately not a general parser.
import { describe, expect, it } from "vitest";
import { parse, print, type Pattern } from "../src/pattern.ts";

const SOUNDS = ["bd", "sd", "hh", "cp", "oh", "rim"];

function randomPattern(length: number): Pattern {
  const steps: (string | null)[] = [];
  for (let i = 0; i < length; i++) {
    const rest = Math.random() < 0.4;
    steps.push(rest ? null : SOUNDS[Math.floor(Math.random() * SOUNDS.length)]);
  }
  return { steps };
}

describe("round trip: parse(print(x)) === x", () => {
  it("holds for many generated patterns of varying length", () => {
    for (let trial = 0; trial < 200; trial++) {
      const length = 1 + Math.floor(Math.random() * 16);
      const pattern = randomPattern(length);
      const code = print(pattern);
      const parsed = parse(code);
      expect(parsed, `failed to round-trip ${code}`).not.toBeNull();
      expect(parsed?.steps).toEqual(pattern.steps);
    }
  });

  it("holds for the empty case: every step a rest", () => {
    const pattern: Pattern = { steps: [null, null, null, null] };
    expect(parse(print(pattern))).toEqual(pattern);
  });

  it("holds for all-on: every step a sound, none a rest", () => {
    const pattern: Pattern = { steps: ["bd", "sd", "hh", "cp"] };
    expect(parse(print(pattern))).toEqual(pattern);
  });

  it("holds for a single step", () => {
    const pattern: Pattern = { steps: ["bd"] };
    expect(parse(print(pattern))).toEqual(pattern);
  });
});

describe("the printed shape", () => {
  it("prints the exact form the brief specifies", () => {
    const pattern: Pattern = {
      steps: ["bd", null, null, "sd", null, null, "hh", null],
    };
    expect(print(pattern)).toBe('s("bd ~ ~ sd ~ ~ hh ~")');
  });
});

describe("anything outside the subset returns null, not a mangled guess", () => {
  it("rejects code that isn't a single s(\"...\") call", () => {
    expect(parse('note("c e g").s("piano")')).toBeNull();
  });

  it("rejects a pattern with mini-notation operators", () => {
    expect(parse('s("bd*2 ~ sd")')).toBeNull();
  });

  it("rejects an empty call", () => {
    expect(parse('s("")')).toBeNull();
  });

  it("rejects a bare empty string", () => {
    expect(parse("")).toBeNull();
  });

  it("rejects a step token that isn't a plain sound name", () => {
    expect(parse('s("bd <sd hh> ~")')).toBeNull();
  });

  it("rejects an embedded quote", () => {
    expect(parse('s("bd " + evil + " sd")')).toBeNull();
  });

  it("rejects a newline inside the code", () => {
    expect(parse('s("bd ~\nsd")')).toBeNull();
  });

  it("rejects a string past the 2000-character ceiling", () => {
    const huge = `s("${"bd ".repeat(700)}")`;
    expect(huge.length).toBeGreaterThan(2000);
    expect(parse(huge)).toBeNull();
  });

  it("rejects non-string input", () => {
    // @ts-expect-error -- deliberately passing the wrong type
    expect(parse(undefined)).toBeNull();
  });
});
