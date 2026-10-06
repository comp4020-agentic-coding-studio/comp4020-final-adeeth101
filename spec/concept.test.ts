// The concept's own promises, against the running app: the grid and the code
// are one track, a track is its owner's from its very first write, and the
// grid never destroys or misrepresents code it can't read.
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

type Track = { slot: string | null; body: string; editable: boolean; steps: (string | null)[] | null };

type Visitor = { cookie: string; slot: string };

// A fresh browser, and the one track it is allowed to start: the server
// derives it from the visitor's id, so a test works it out the same way.
async function visitor(): Promise<Visitor> {
  const res = await fetch(new URL("/api/me", baseUrl));
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  const { id } = (await res.json()) as { id: string };
  return { cookie, slot: `t-${id.slice(0, 12)}` };
}

const act = (who: Visitor | string, input: Record<string, unknown>) =>
  fetch(new URL("/api/act", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: typeof who === "string" ? who : who.cookie,
    },
    body: JSON.stringify(input),
  });

async function track(who: Visitor, slot: string): Promise<Track | undefined> {
  const res = await fetch(new URL("/api/state", baseUrl), { headers: { cookie: who.cookie } });
  const state = (await res.json()) as { traces: Track[] };
  return state.traces.find((t) => t.slot === slot);
}

it("keeps the grid and the code as one thing, in both directions", async () => {
  const me = await visitor();

  expect((await act(me, { slot: me.slot, step: 0, sound: "bd" })).status).toBe(200);
  expect((await act(me, { slot: me.slot, step: 3, sound: "sd" })).status).toBe(200);
  let t = await track(me, me.slot);
  expect(t?.body, "a toggle should rewrite the code").toBe('s("bd ~ ~ sd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")');
  expect(t?.steps?.slice(0, 4)).toEqual(["bd", null, null, "sd"]);
  expect(t?.steps, "a new track is a whole 16-step bar").toHaveLength(16);

  expect((await act(me, { slot: me.slot, body: 's("hh hh ~ cp")' })).status).toBe(200);
  t = await track(me, me.slot);
  expect(t?.editable, "code in the grid's shape should stay editable").toBe(true);
  expect(t?.steps, "editing the code should change the grid").toEqual(["hh", "hh", null, "cp"]);
});

it("never lets the grid overwrite hand-written code", async () => {
  const me = await visitor();
  const code = 's("bd*2 [~ sd]").fast(2)';

  expect((await act(me, { slot: me.slot, body: code })).status).toBe(200);
  expect((await track(me, me.slot))?.editable).toBe(false);

  const res = await act(me, { slot: me.slot, step: 0, sound: "bd" });
  expect(res.status, "a toggle on hand-written code must be refused").toBe(409);
  expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  expect((await track(me, me.slot))?.body, "the hand-written code must survive the refusal").toBe(code);
});

it("keeps a bar longer than the grid as code, rather than offering steps it can't edit", async () => {
  const fits = await visitor();
  const thirtyTwo = `s("${Array(32).fill("bd").join(" ")}")`;
  expect((await act(fits, { slot: fits.slot, body: thirtyTwo })).status).toBe(200);
  expect((await track(fits, fits.slot))?.editable, "32 steps is a whole grid").toBe(true);
  expect((await act(fits, { slot: fits.slot, step: 31, sound: "sd" })).status).toBe(200);

  const over = await visitor();
  const thirtyThree = `s("${Array(33).fill("bd").join(" ")}")`;
  expect((await act(over, { slot: over.slot, body: thirtyThree })).status).toBe(200);
  const t = await track(over, over.slot);
  expect(t?.editable, "33 steps can't be shown as an editable grid").toBe(false);
  expect(t?.steps).toBeNull();
  expect((await act(over, { slot: over.slot, step: 0, sound: "sd" })).status).toBe(409);
  expect((await track(over, over.slot))?.body, "the long bar must be kept as written").toBe(thirtyThree);
});

it("refuses a step index that would make the server build a huge bar", async () => {
  const me = await visitor();
  const started = Date.now();
  const res = await act(me, { slot: me.slot, step: 200_000_000, sound: "bd" });
  expect(res.status).toBe(400);
  expect(Date.now() - started, "refusing must be instant, not after building the array").toBeLessThan(1000);

  for (const step of [-1, 1.5, "three", "-1", 32, "32"]) {
    expect((await act(me, { slot: me.slot, step, sound: "bd" })).status, `step ${String(step)}`).toBe(400);
  }
  expect((await act(me, { slot: me.slot, step: 31, sound: "bd" })).status).toBe(200);
});

it("only writes plain sound names from the grid", async () => {
  const me = await visitor();
  for (const sound of ['bd"); fetch("x', "bd sd", "<b>", "averyveryverylongname", 7]) {
    const res = await act(me, { slot: me.slot, step: 0, sound });
    expect(res.status, `sound ${JSON.stringify(sound)} should be refused`).toBe(400);
  }
});

it("keeps each track its owner's", async () => {
  const owner = await visitor();
  const other = await visitor();

  expect((await act(owner, { slot: owner.slot, step: 0, sound: "bd" })).status).toBe(200);
  expect((await act(other, { slot: owner.slot, step: 1, sound: "sd" })).status).toBe(403);
  expect((await act(other, { slot: owner.slot, body: 's("cp")' })).status).toBe(403);
  expect((await track(owner, owner.slot))?.steps?.[0]).toBe("bd");
});

it("doesn't let anyone start a track reserved for someone who hasn't written yet", async () => {
  const early = await visitor();
  const late = await visitor();

  const grab = await act(early, { slot: late.slot, step: 0, sound: "bd" });
  expect(grab.status, "starting another visitor's track must be refused").toBe(403);
  const mine = await act(late, { slot: late.slot, step: 0, sound: "bd" });
  expect(mine.status, "the owner's own first press must still work").toBe(200);
});

it("gives each visitor one track to start, not as many as they name", async () => {
  const me = await visitor();
  expect((await act(me, { slot: me.slot, step: 0, sound: "bd" })).status).toBe(200);
  const second = await act(me, { slot: `second-${Math.random().toString(36).slice(2)}`, step: 0, sound: "bd" });
  expect(second.status, "a second, self-named track must be refused").toBe(403);
  expect((await act(me, { slot: "x".repeat(65), body: 's("bd")' })).status).toBe(400);
});

it("cycles a step through the kit when no sound is named, which is all a no-script grid can send", async () => {
  const me = await visitor();
  const seen: (string | null)[] = [];
  for (let press = 0; press < 5; press++) {
    // Form-encoded, as the grid's buttons post without a script.
    const res = await fetch(new URL("/api/act", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: me.cookie },
      body: new URLSearchParams({ slot: me.slot, step: "0" }).toString(),
      redirect: "manual",
    });
    expect(res.status, "a grid press should redirect like any form post").toBe(303);
    seen.push((await track(me, me.slot))?.steps?.[0] ?? null);
  }
  expect(seen).toEqual(["bd", "sd", "hh", "cp", null]);
});

it("keeps the identity cookie away from scripts, and survives other sites' broken cookies", async () => {
  const res = await fetch(new URL("/api/me", baseUrl));
  const set = res.headers.getSetCookie()[0];
  expect(set, "the signed identity must be HttpOnly").toMatch(/;\s*HttpOnly/i);

  const me = await visitor();
  const broken = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: `unrelated=%ZZ; ${me.cookie}` },
  });
  expect(broken.status, "a malformed unrelated cookie must not break the request").toBe(200);
  expect(((await broken.json()) as { id: string }).id.slice(0, 12)).toBe(me.slot.slice(2));
});
