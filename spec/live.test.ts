// What this protects: other people's changes reach an open page promptly and
// boundedly, and the page says when live updates are down. The real page and
// script run in jsdom with a stub EventSource and a counting fetch.
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

// `hold` makes each refresh's response wait until released.
function open(hold = false) {
  const dom = new JSDOM(html, { url: String(baseUrl), runScripts: "outside-only" });
  windows.push(dom);
  const win = dom.window as unknown as Record<string, any>;
  const gets: number[] = [];
  const release: Array<() => void> = [];
  const start = Date.now();
  win.fetch = () => {
    gets.push(Date.now() - start);
    if (!hold) return Promise.resolve(new Response(html));
    return new Promise<Response>((resolve) => release.push(() => resolve(new Response(html))));
  };
  const listeners = new Map<string, Array<() => void>>();
  win.EventSource = class {
    addEventListener(kind: string, fn: () => void) {
      listeners.set(kind, [...(listeners.get(kind) ?? []), fn]);
    }
  };
  dom.window.eval(source);
  const status = () => dom.window.document.querySelector("[data-status]") as HTMLElement;
  return {
    gets,
    release,
    status,
    emit: (kind: string) => (listeners.get(kind) ?? []).forEach((fn) => fn()),
  };
}

it("refreshes when another visitor renames", async () => {
  const page = open();
  page.emit("visitor.renamed");
  await wait(250);
  expect(page.gets).toHaveLength(1);
});

it("refreshes within about 200 ms of the first event in a steady stream", async () => {
  const page = open();
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    page.emit("trace.updated");
    await wait(50);
  }
  expect(page.gets.length).toBeGreaterThanOrEqual(1);
  expect(page.gets[0]).toBeLessThan(200); // measured from the first event (t0 = 0 on the page clock)
});

it("queues exactly one more refresh for events during an in-flight one", async () => {
  const page = open(true);
  page.emit("trace.created");
  await wait(250);
  expect(page.gets).toHaveLength(1); // in flight, unreleased
  for (let i = 0; i < 5; i++) page.emit("trace.updated");
  await wait(250);
  expect(page.gets).toHaveLength(1); // still waiting on the first
  page.release[0]();
  await wait(300);
  expect(page.gets).toHaveLength(2);
  page.release[1]();
  await wait(300);
  expect(page.gets).toHaveLength(2); // nothing further was queued
});

it("shows a message on error, clears it on open, and leaves other messages alone", async () => {
  const page = open();
  page.emit("error");
  expect(page.status().textContent).toBe("Live updates paused — reconnecting…");
  page.emit("open");
  expect(page.status().textContent).toBe("");

  page.status().textContent = "saved";
  page.emit("error");
  expect(page.status().textContent).toBe("saved");
  page.emit("open");
  expect(page.status().textContent).toBe("saved");
});
