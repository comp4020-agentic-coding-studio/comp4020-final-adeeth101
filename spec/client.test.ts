// What this protects: public/app.js never throws away what a person typed or
// replays what they did. The real page and the real script run in jsdom, with
// a fetch and an EventSource this file controls. The script is an ES module
// only for its `type` attribute (no imports or exports), so evaluating its
// text in the window as a plain script is the same code.
import { JSDOM } from "jsdom";
import { afterEach, beforeAll, expect, it, inject } from "vitest";

const baseUrl = inject("baseUrl");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { url: string; method: string };
type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void };
const deferred = (): Deferred => {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let html = "";
let source = "";
beforeAll(async () => {
  html = await (await fetch(new URL("/", baseUrl))).text();
  source = await (await fetch(new URL("/static/app.js", baseUrl))).text();
});

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));

// The page's own HTML with the editor's saved text swapped for `saved`.
const withSaved = (saved: string) => html.replace("</textarea>", `${saved}</textarea>`);

function open(handler: (call: Call) => Promise<Response>) {
  const dom = new JSDOM(html, { url: String(baseUrl), runScripts: "outside-only" });
  windows.push(dom);
  const win = dom.window as unknown as Record<string, any>;
  const calls: Call[] = [];
  const submits: unknown[] = [];
  win.fetch = (url: string, init?: { method?: string }) => {
    const call = { url: String(url), method: init?.method ?? "GET" };
    calls.push(call);
    return handler(call);
  };
  const listeners = new Map<string, Array<() => void>>();
  win.EventSource = class {
    addEventListener(kind: string, fn: () => void) {
      listeners.set(kind, [...(listeners.get(kind) ?? []), fn]);
    }
  };
  win.HTMLFormElement.prototype.submit = function () {
    submits.push(this);
  };
  dom.window.eval(source);
  const doc = dom.window.document;
  return {
    // A TypeError must come from the page's own realm to be one there.
    win,
    doc,
    calls,
    submits,
    body: () => doc.getElementById("body") as HTMLTextAreaElement,
    type(text: string) {
      const el = doc.getElementById("body") as HTMLTextAreaElement;
      el.value = text;
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    },
    // What the event stream does when someone else changes something.
    async remoteUpdate() {
      for (const fn of listeners.get("trace.updated") ?? []) fn();
      await wait(200);
    },
  };
}

it("keeps an unsaved draft through a remote update, even after focus moved", async () => {
  const page = open(async () => new Response(withSaved("s(\"hh*4\")")));
  const before = page.body();
  page.type("my unsaved draft");
  (page.doc.querySelector("[data-play]") as HTMLButtonElement).focus();
  expect(page.doc.activeElement).not.toBe(before);

  await page.remoteUpdate();

  expect(page.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  expect(page.body()).not.toBe(before); // the region really was swapped
  expect(page.body().value).toBe("my unsaved draft");
});

it("does not hold the editor once the draft is saved: the server's text arrives", async () => {
  const page = open(async () => new Response(withSaved("from the server")));
  await page.remoteUpdate();
  expect(page.body().value).toBe("from the server");
});

it("keeps text typed while a code save was in flight", async () => {
  const save = deferred();
  const page = open((call) => (call.url === "/api/act" ? save.promise : Promise.resolve(new Response(withSaved("one")))));
  page.type("one");
  (page.doc.querySelector("[data-compose]") as HTMLFormElement).requestSubmit();
  await wait(20);
  page.type("one two");

  save.resolve(json({ ok: true }));
  await wait(100);

  expect(page.body().value).toBe("one two");
  // ...and it is still a draft, so a later remote update keeps it too.
  await page.remoteUpdate();
  expect(page.body().value).toBe("one two");
});

it("clears the draft when the saved text is what is in the editor", async () => {
  const page = open((call) =>
    Promise.resolve(call.url === "/api/act" ? json({ ok: true }) : new Response(withSaved("one"))),
  );
  page.type("one");
  (page.doc.querySelector("[data-compose]") as HTMLFormElement).requestSubmit();
  await wait(100);
  await page.remoteUpdate();
  expect(page.body().value).toBe("one");
});

it("on a network failure, neither navigates nor repeats the step, and says so", async () => {
  let realm: { TypeError: new (m: string) => Error } | null = null;
  const page = open((call) =>
    call.url === "/api/act" ? Promise.reject(new realm!.TypeError("Failed to fetch")) : Promise.resolve(new Response(html)),
  );
  realm = page.win as never;
  page.type("still here");
  (page.doc.querySelector("[data-grid] button[value='3']") as HTMLButtonElement).click();
  await wait(100);

  expect(page.submits).toHaveLength(0);
  expect(page.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(page.calls.filter((c) => c.method === "GET")).toHaveLength(1); // reconciled, not retried
  expect(page.doc.querySelector("[data-status]")!.textContent).toMatch(/may not have saved/);
  expect(page.body().value).toBe("still here");

  // The message is persistent: a later update does not wipe it.
  await page.remoteUpdate();
  expect(page.doc.querySelector("[data-status]")!.textContent).toMatch(/may not have saved/);
  expect(page.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

it("discards a refresh response that arrives after a newer one", async () => {
  // Events never put two refreshes in flight (spec/live.test.ts holds that),
  // but a save refreshes directly, so one can overtake a scheduled refresh
  // that is still waiting. The older answer must not win.
  const gets: Deferred[] = [];
  const page = open((call) => {
    if (call.method === "POST") return Promise.resolve(json({ ok: true }));
    const d = deferred();
    gets.push(d);
    return d.promise;
  });
  await page.remoteUpdate(); // refresh 1, from the stream, held open
  expect(gets).toHaveLength(1);

  page.type("newer");
  page.doc
    .querySelector("[data-compose]")!
    .dispatchEvent(new page.win.Event("submit", { bubbles: true, cancelable: true }));
  await wait(50); // the save lands, then refreshes: refresh 2
  expect(gets).toHaveLength(2);

  gets[1].resolve(new Response(withSaved("newer")));
  await wait(50);
  gets[0].resolve(new Response(withSaved("older")));
  await wait(50);

  expect(page.body().value, "an older refresh overwrote a newer one").toBe("newer");
});
