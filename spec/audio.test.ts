// What this protects: the transport never claims more than happened. The real
// page and public/app.js run in jsdom; Strudel is replaced by a stand-in whose
// script "loads" when the test says so. These are state transitions, not sound.
import { JSDOM } from "jsdom";
import { afterEach, beforeAll, expect, it, inject } from "vitest";

const baseUrl = inject("baseUrl");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let html = "";
let source = "";
beforeAll(async () => {
  html = await (await fetch(new URL("/", baseUrl))).text();
  source = await (await fetch(new URL("/static/app.js", baseUrl))).text();
});

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));

function open(evaluate: (code: string) => Promise<void> = async () => {}) {
  const dom = new JSDOM(html, { url: String(baseUrl), runScripts: "outside-only" });
  windows.push(dom);
  const win = dom.window as unknown as Record<string, any>;
  // A refresh gets the page back with nobody's track on it.
  const bare = new JSDOM(html);
  bare.window.document.querySelectorAll(".trace").forEach((el) => el.remove());
  const bareHtml = bare.serialize();
  win.fetch = async () => new Response(bareHtml);
  const updated: Array<() => void> = [];
  win.EventSource = class {
    addEventListener(kind: string, fn: () => void) {
      if (kind === "trace.updated") updated.push(fn);
    }
  };
  const doc = dom.window.document;
  // One playable grid track, whatever the server happens to hold.
  doc.querySelectorAll(".trace").forEach((el) => el.remove());
  const list = doc.querySelector("[data-region]") ?? doc.body;
  const li = doc.createElement("li");
  li.className = "trace";
  li.dataset.slot = "1";
  li.dataset.kind = "pattern";
  li.innerHTML = '<pre class="trace__body"><code>s("bd")</code></pre>';
  list.append(li);

  const counts = { init: 0, evaluate: 0, hush: 0 };
  win.initStrudel = async () => void counts.init++;
  win.strudel = {
    samples: async () => {},
    hush: () => void counts.hush++,
    evaluate: async (code: string) => {
      counts.evaluate++;
      await evaluate(code);
    },
  };
  dom.window.eval(source);
  const button = doc.querySelector("[data-play]") as HTMLButtonElement;
  return {
    doc,
    li,
    counts,
    button,
    async remoteUpdate() {
      updated.forEach((fn) => fn());
      await wait(250);
    },
    status: () => doc.querySelector("[data-audio-status]")!.textContent ?? "",
    scripts: () => doc.head.querySelectorAll("script[src*='strudel']").length,
    // The injected <script> finishes loading.
    async loaded() {
      (doc.head.querySelector("script[src*='strudel']") as any).onload();
      await wait(20);
    },
  };
}

it("evaluation rejects with nothing to fall back to: never says Playing", async () => {
  const page = open(async () => {
    throw new Error("boom");
  });
  page.li.dataset.kind = "code"; // not vouched for by the grid
  page.li.dataset.mine = "true";
  page.button.click();
  await page.loaded();
  await wait(20);

  expect(page.status()).not.toMatch(/Playing/);
  expect(page.status()).toMatch(/Nothing is playing.*boom/);
  expect(page.button.textContent).toBe("Play");
  expect(page.button.getAttribute("aria-pressed")).toBe("false");
});

it("only claims the fallback when the fallback itself ran", async () => {
  const page = open(async (code) => {
    if (code.includes("bad")) throw new Error("boom");
  });
  const bad = page.li.cloneNode(true) as HTMLElement;
  bad.dataset.kind = "code";
  bad.dataset.mine = "true";
  bad.querySelector("code")!.textContent = "bad()";
  page.li.after(bad);
  page.button.click();
  await page.loaded();
  expect(page.status()).toMatch(/Playing the patterns that did/);
  expect(page.button.getAttribute("aria-pressed")).toBe("true");
});

it("Stop during loading: evaluate is never called", async () => {
  const page = open();
  page.button.click();
  expect(page.button.getAttribute("aria-pressed")).toBe("false");
  page.button.click(); // Stop
  expect(page.status()).toBe("Stopped.");
  await page.loaded();
  expect(page.counts.evaluate).toBe(0);
  expect(page.status()).toBe("Stopped.");
  expect(page.button.textContent).toBe("Play");
});

it("double Play during loading: one load, and nothing starts by itself", async () => {
  const page = open();
  page.button.click();
  page.button.click();
  await page.loaded();
  expect(page.scripts()).toBe(1);
  expect(page.counts.init).toBe(1);
  expect(page.counts.evaluate).toBe(0);
});

it("plays, and only says so after evaluate resolves", async () => {
  let release!: () => void;
  const page = open(() => new Promise<void>((r) => (release = r)));
  page.button.click();
  await page.loaded();
  expect(page.status()).not.toMatch(/Playing/);
  release();
  await wait(20);
  expect(page.status()).toMatch(/Playing 1 track/);
  expect(page.button.getAttribute("aria-pressed")).toBe("true");
});

it("an empty selection while playing hushes and says so", async () => {
  const page = open();
  page.button.click();
  await page.loaded();
  expect(page.status()).toMatch(/Playing/);
  const hushed = page.counts.hush;

  await page.remoteUpdate(); // the track is gone

  expect(page.counts.hush).toBe(hushed + 1);
  expect(page.status()).toMatch(/Nothing is playing/);
});

it("a hung load ends in a retryable failure", async () => {
  const page = open();
  const timers: Array<() => void> = [];
  (page.doc.defaultView as any).setTimeout = (fn: () => void) => void timers.push(fn);
  page.button.click(); // script never loads
  timers[0]();
  await wait(20);
  expect(page.status()).toMatch(/timed out.*Press Play/);
  expect(page.button.textContent).toBe("Play");
  page.button.click();
  expect(page.scripts()).toBe(2); // retry starts a fresh load
});
