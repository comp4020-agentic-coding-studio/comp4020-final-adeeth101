// What this protects: the page's own promises, as a visitor's browser meets
// them. The server's rules are covered elsewhere; these are the things the
// HTML has to keep saying however the interface is rebuilt --- a working grid
// with no script, controls only where they would be accepted, and sound that
// stays opt-in. Everything runs over HTTP against the running app.
import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

type Visitor = { cookie: string };

const form = (fields: Record<string, string>): URLSearchParams => new URLSearchParams(fields);

// A fresh browser: its cookie comes from the first GET /, as a real one's does.
async function newVisitor(): Promise<Visitor> {
  const res = await fetch(url("/"), { redirect: "manual" });
  await res.text();
  const set = res.headers.get("set-cookie") ?? "";
  expect(set, "a new visitor's first page set no cookie, so they could never be recognised").not.toBe("");
  return { cookie: set.split(";")[0] };
}

async function postForm(v: Visitor, path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: v.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
}

async function pageOf(v: Visitor): Promise<{ doc: Document; html: string }> {
  const res = await fetch(url("/"), { headers: { cookie: v.cookie } });
  const html = await res.text();
  return { doc: new JSDOM(html).window.document, html };
}

const slotOf = (doc: Document): string => {
  const slot = doc.querySelector<HTMLInputElement>("form[data-grid] input[type=hidden][name=slot]");
  expect(slot, "the grid has no hidden slot input, so a press can't say which track it means").not.toBeNull();
  return slot?.value ?? "";
};

const press = (v: Visitor, slot: string, step: number): Promise<Response> =>
  postForm(v, "/api/act", { slot, step: String(step) });

const stepButton = (doc: Document, step: number): Element | null =>
  doc.querySelector(`form[data-grid] button[name="step"][value="${step}"]`);

const body = (doc: Document): string => doc.querySelector<HTMLTextAreaElement>("#body")?.value ?? "";

describe("the grid", () => {
  it("is there for a new visitor, with 16 labelled steps", async () => {
    const v = await newVisitor();
    const { doc } = await pageOf(v);
    const grid = doc.querySelector("form[data-grid]");
    expect(grid, "a new visitor's page has no form[data-grid], so they can't make a track").not.toBeNull();
    expect(grid?.getAttribute("action"), "the grid doesn't post to /api/act").toBe("/api/act");
    expect((grid?.getAttribute("method") ?? "").toLowerCase(), "the grid doesn't use POST").toBe("post");
    slotOf(doc);

    const buttons = Array.from(grid?.querySelectorAll("button[type=submit][name=step]") ?? []);
    expect(buttons.length, "the grid doesn't have exactly 16 step buttons").toBe(16);
    expect(
      buttons.map((b) => b.getAttribute("value")),
      "the step buttons aren't valued 0 to 15 in order",
    ).toEqual(Array.from({ length: 16 }, (_, i) => String(i)));
    for (const b of buttons) {
      expect(
        (b.getAttribute("aria-label") ?? "").trim(),
        `step ${b.getAttribute("value")} has no aria-label, so a screen reader can't name it`,
      ).not.toBe("");
    }
  });

  it("works with no script: a plain form post redirects home and shows in the grid and the code", async () => {
    const v = await newVisitor();
    const slot = slotOf((await pageOf(v)).doc);

    const res = await press(v, slot, 4);
    expect(res.status, "pressing a step with a plain form didn't answer 303").toBe(303);
    expect(new URL(res.headers.get("location") ?? "", baseUrl).pathname, "the press didn't redirect to /").toBe("/");

    const { doc } = await pageOf(v);
    expect(
      stepButton(doc, 4)?.getAttribute("aria-pressed"),
      "after pressing step 4 the page doesn't show it as pressed",
    ).toBe("true");
    expect(stepButton(doc, 5)?.getAttribute("aria-pressed"), "an unpressed step shows as pressed").toBe("false");
    expect(body(doc), "the code editor doesn't hold the track the press made").toContain("bd");
    expect(body(doc), "the code editor is empty after a press").not.toBe("");
  });

  it("cycles one step kick, snare, hat, clap, rest over five presses", async () => {
    const v = await newVisitor();
    const slot = slotOf((await pageOf(v)).doc);
    const expected = ["bd", "sd", "hh", "cp", null];

    for (const [n, sound] of expected.entries()) {
      expect((await press(v, slot, 2)).status, `press ${n + 1} wasn't accepted`).toBe(303);
      const { doc } = await pageOf(v);
      const steps = body(doc).match(/s\("([^"]*)"\)/)?.[1]?.split(/\s+/) ?? [];
      expect(
        steps[2],
        `after press ${n + 1} step 2 should be ${sound ?? "a rest"}, but the code reads: ${body(doc)}`,
      ).toBe(sound ?? "~");
      expect(
        stepButton(doc, 2)?.getAttribute("aria-pressed"),
        `after press ${n + 1} the button's pressed state is wrong for ${sound ?? "a rest"}`,
      ).toBe(sound ? "true" : "false");
    }
  });
});

describe("other people's tracks", () => {
  it("are shown to a second visitor with no form and no button inside them", async () => {
    const a = await newVisitor();
    const slotA = slotOf((await pageOf(a)).doc);
    expect((await press(a, slotA, 0)).status).toBe(303);

    const b = await newVisitor();
    const { doc } = await pageOf(b);
    const theirs = doc.querySelector(`[data-slot="${slotA}"]`);
    expect(theirs, "visitor B's page doesn't show visitor A's track in the room").not.toBeNull();
    expect(theirs?.getAttribute("data-mine"), "A's track is marked as B's own").toBe("false");
    expect(
      theirs?.querySelectorAll("form, button, input, textarea, select, a[href]").length,
      "B is offered a control inside A's track, which the server would refuse",
    ).toBe(0);
    expect(
      doc.querySelectorAll(`form[data-grid] input[name=slot][value="${slotA}"]`).length,
      "B's own grid points at A's track",
    ).toBe(0);
  });
});

describe("hand-written code", () => {
  it("keeps the grid out of the way and is shown exactly as written", async () => {
    const v = await newVisitor();
    const code = 's("bd*2").fast(2)';
    const slot = slotOf((await pageOf(v)).doc);
    const res = await postForm(v, "/api/act", { slot, body: code });
    expect(res.status, "saving hand-written code with a plain form didn't answer 303").toBe(303);

    const { doc } = await pageOf(v);
    expect(
      doc.querySelector("form[data-grid]"),
      "the grid is still offered over code it can't read, where a press would be refused or overwrite it",
    ).toBeNull();
    expect(body(doc), "the editor doesn't hold exactly the code that was saved").toBe(code);
  });
});

describe("renaming", () => {
  it("a form post to /api/handle redirects and the new name shows", async () => {
    const v = await newVisitor();
    const name = `tester ${Math.random().toString(36).slice(2, 8)}`;
    const res = await postForm(v, "/api/handle", { handle: name });
    expect(res.status, "renaming with a plain form didn't answer 303").toBe(303);
    const { doc } = await pageOf(v);
    expect(doc.querySelector("[data-handle]")?.textContent?.trim(), "the page doesn't show the new name").toBe(name);
  });

  it("an empty name is refused with 400 and a notice on the page", async () => {
    const v = await newVisitor();
    const res = await postForm(v, "/api/handle", { handle: "" });
    expect(res.status, "an empty name wasn't refused with 400").toBe(400);
    const doc = new JSDOM(await res.text()).window.document;
    const notice = doc.querySelector('.notice[role="status"]');
    expect(notice, "the refusal shows no .notice[role=status], so the person isn't told why").not.toBeNull();
    expect((notice?.textContent ?? "").trim(), "the notice is empty").not.toBe("");
  });
});

describe("the event stream", () => {
  // Reads /api/events for `ms`, returning the text received so far. The fetch
  // is aborted at the end so the connection never outlives the test. The
  // response promise is not awaited up front, so the timing holds whether or
  // not the server sends anything before its first event.
  async function listen(since: number, ms: number, during?: () => Promise<void>): Promise<string> {
    const abort = new AbortController();
    let text = "";
    const pump = fetch(url(`/api/events?since=${since}`), { signal: abort.signal })
      .then(async (res) => {
        expect(res.status, "the event stream didn't open").toBe(200);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          text += decoder.decode(value, { stream: true });
        }
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) throw e;
      });
    await new Promise((r) => setTimeout(r, ms));
    if (during) {
      await during();
      await new Promise((r) => setTimeout(r, 700));
    }
    abort.abort();
    await pump;
    return text;
  }

  it("starts where the page left off, then delivers new changes", async () => {
    const seed = await newVisitor();
    await press(seed, slotOf((await pageOf(seed)).doc), 0);

    const state = (await (await fetch(url("/api/state"))).json()) as { meta: { latestEvent: number } };
    const latest = state.meta.latestEvent;
    expect(typeof latest, "/api/state has no meta.latestEvent for the stream to start from").toBe("number");

    const v = await newVisitor();
    const slot = slotOf((await pageOf(v)).doc);
    let text = "";
    // Other spec files write to the same app while this one listens, so new
    // events may well arrive here. What must not arrive is anything at or
    // before the point the page was rendered: that would be a replay.
    const quiet = await listen(latest, 1000);
    const replayed = [...quiet.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])).filter((id) => id <= latest);
    expect(
      replayed,
      "the stream replayed earlier events although it was told where the page left off",
    ).toEqual([]);

    text = await listen(latest, 300, async () => {
      expect((await press(v, slot, 1)).status).toBe(303);
    });
    expect(text, "a change made after the stream opened never arrived on it").toMatch(/^event: trace\./m);
  }, 15_000);
});

describe("sound is opt-in", () => {
  it("loads no audio script from the server HTML, and ships the transport hidden", async () => {
    const v = await newVisitor();
    const { doc, html } = await pageOf(v);
    for (const s of Array.from(doc.querySelectorAll("script[src]"))) {
      const src = s.getAttribute("src") ?? "";
      expect(src, `a script tag loads ${src} before anyone asks for sound`).not.toMatch(/unpkg\.com|strudel/i);
    }
    expect(html, "the server HTML mentions unpkg.com, so sound may load without being asked").not.toMatch(/unpkg\.com/i);

    const transport = doc.querySelector("[data-transport]");
    expect(transport, "the [data-transport] section is missing").not.toBeNull();
    expect(
      transport?.hasAttribute("hidden"),
      "the sound controls are visible with no script running, where they can't work",
    ).toBe(true);
  });
});
