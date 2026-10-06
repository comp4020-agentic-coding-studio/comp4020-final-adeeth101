// The concept's own promises, against the running app: the grid and the code
// are one track, a track is its owner's, and the grid never destroys code it
// can't read.
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

type Track = { slot: string | null; body: string; editable: boolean; steps: (string | null)[] | null };

async function visitor(): Promise<string> {
  const res = await fetch(new URL("/api/me", baseUrl));
  return res.headers.getSetCookie()[0].split(";")[0];
}

const act = (cookie: string, input: Record<string, unknown>) =>
  fetch(new URL("/api/act", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(input),
  });

async function track(cookie: string, slot: string): Promise<Track | undefined> {
  const res = await fetch(new URL("/api/state", baseUrl), { headers: { cookie } });
  const state = (await res.json()) as { traces: Track[] };
  return state.traces.find((t) => t.slot === slot);
}

const slot = (): string => `spec-${Math.random().toString(36).slice(2, 10)}`;

it("keeps the grid and the code as one thing, in both directions", async () => {
  const me = await visitor();
  const mine = slot();

  expect((await act(me, { slot: mine, step: 0, sound: "bd" })).status).toBe(200);
  expect((await act(me, { slot: mine, step: 3, sound: "sd" })).status).toBe(200);
  let t = await track(me, mine);
  expect(t?.body, "a toggle should rewrite the code").toBe('s("bd ~ ~ sd")');
  expect(t?.steps).toEqual(["bd", null, null, "sd"]);

  expect((await act(me, { slot: mine, body: 's("hh hh ~ cp")' })).status).toBe(200);
  t = await track(me, mine);
  expect(t?.editable, "code in the grid's shape should stay editable").toBe(true);
  expect(t?.steps, "editing the code should change the grid").toEqual(["hh", "hh", null, "cp"]);
});

it("never lets the grid overwrite hand-written code", async () => {
  const me = await visitor();
  const mine = slot();
  const code = 's("bd*2 [~ sd]").fast(2)';

  expect((await act(me, { slot: mine, body: code })).status).toBe(200);
  expect((await track(me, mine))?.editable).toBe(false);

  const res = await act(me, { slot: mine, step: 0, sound: "bd" });
  expect(res.status, "a toggle on hand-written code must be refused").toBe(409);
  expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  expect((await track(me, mine))?.body, "the hand-written code must survive the refusal").toBe(code);
});

it("refuses a step index that would make the server build a huge bar", async () => {
  const me = await visitor();
  const started = Date.now();
  const res = await act(me, { slot: slot(), step: 200_000_000, sound: "bd" });
  expect(res.status).toBe(400);
  expect(Date.now() - started, "refusing must be instant, not after building the array").toBeLessThan(1000);

  for (const step of [-1, 1.5, "3", 32]) {
    expect((await act(me, { slot: slot(), step, sound: "bd" })).status, `step ${String(step)}`).toBe(400);
  }
  expect((await act(me, { slot: slot(), step: 31, sound: "bd" })).status).toBe(200);
});

it("only writes plain sound names from the grid", async () => {
  const me = await visitor();
  for (const sound of ['bd"); fetch("x', "bd sd", "<b>", "averyveryverylongname", 7]) {
    const res = await act(me, { slot: slot(), step: 0, sound });
    expect(res.status, `sound ${JSON.stringify(sound)} should be refused`).toBe(400);
  }
});

it("keeps each track its owner's", async () => {
  const owner = await visitor();
  const other = await visitor();
  const theirs = slot();

  expect((await act(owner, { slot: theirs, step: 0, sound: "bd" })).status).toBe(200);
  expect((await act(other, { slot: theirs, step: 1, sound: "sd" })).status).toBe(403);
  expect((await act(other, { slot: theirs, body: 's("cp")' })).status).toBe(403);
  expect((await track(owner, theirs))?.body).toBe('s("bd")');
});
