// The brief's third fixed requirement: what someone does "is still there when
// they, or anyone else, come back, across sessions, restarts and redeploys".
//
// Unlike the other specs this one does not use the already-running app: it
// starts its own on a spare port with a throwaway database, because the only
// way to test a restart is to perform one. Fly stops this machine whenever
// nobody is using it, so a restart is routine, not rare.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

const PORT = 8300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "spec-persist-"));
const DB_PATH = join(dir, "app.db");

let server: ChildProcess | null = null;

async function boot(): Promise<void> {
  server = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: String(PORT), DB_PATH },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      await fetch(`${base}/healthz`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`the app never came up on ${PORT}`);
}

// SIGKILL, not a graceful stop: a machine that is stopped mid-write is the
// case worth protecting against, and the gentle path would prove less.
function stop(): Promise<void> {
  const dying = server;
  server = null;
  if (!dying) return Promise.resolve();
  return new Promise((resolve) => {
    dying.on("exit", () => resolve());
    dying.kill("SIGKILL");
  });
}

afterAll(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

it("remembers a visitor and their trace across restarts", async () => {
  await boot();

  const left = await fetch(`${base}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "a trace left before the restart" }),
  });
  expect(left.status).toBe(200);

  const setCookie = left.headers.getSetCookie();
  expect(setCookie, "a new visitor must be given a cookie").not.toEqual([]);
  const cookie = setCookie[0].split(";")[0];

  const before = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as {
    id: string;
  };

  // Three times, because a bug that loses state on the first restart and a bug
  // that loses it on every one look identical after a single cycle.
  for (let restart = 1; restart <= 3; restart++) {
    await stop();
    await boot();

    const state = (await (await fetch(`${base}/api/state`, { headers: { cookie } })).json()) as {
      you: { id: string };
      traces: { mine?: boolean; body: string }[];
    };

    expect(state.you.id, `restart ${restart}: the visitor was not recognised`).toBe(before.id);

    const mine = state.traces.filter((trace) => trace.mine);
    expect(mine.map((trace) => trace.body), `restart ${restart}: their trace was lost`).toContain(
      "a trace left before the restart",
    );
  }
});

it("tells two visitors apart and shows each only their own as theirs", async () => {
  if (!server) await boot();

  const act = async (body: string, cookie?: string) =>
    fetch(`${base}/api/act`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ body }),
    });

  const one = await act("written by the first visitor");
  const two = await act("written by the second visitor");
  const cookieOne = one.headers.getSetCookie()[0].split(";")[0];
  const cookieTwo = two.headers.getSetCookie()[0].split(";")[0];
  expect(cookieOne).not.toBe(cookieTwo);

  const seen = (await (await fetch(`${base}/api/state`, {
    headers: { cookie: cookieOne },
  })).json()) as { traces: { mine?: boolean; body: string }[] };

  const mine = seen.traces.filter((trace) => trace.mine).map((trace) => trace.body);
  expect(mine).toContain("written by the first visitor");
  expect(mine).not.toContain("written by the second visitor");
});
