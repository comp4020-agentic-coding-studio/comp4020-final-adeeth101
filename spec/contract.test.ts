// Protects docs/contract.md: identity, POST /api/act both ways, /api/state's
// `mine` marking, /readme/ staying live, method/path discipline, /healthz, and
// GET /api/events. Each test says what broke in its own message, since a
// failure that doesn't is not done.
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

// A fresh cookie jar per call: the app's own Set-Cookie is the only source of
// a visitor's cookie, so each helper reads it back out rather than inventing one.
async function freshVisitor(): Promise<{ cookie: string; id: string }> {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: `hello from a fresh visitor ${Math.random()}` }),
  });
  const setCookie = res.headers.getSetCookie();
  expect(setCookie, "a new visitor must receive a cookie").not.toEqual([]);
  const cookie = setCookie[0].split(";")[0];
  const me = (await (await fetch(url("/api/me"), { headers: { cookie } })).json()) as {
    id: string;
  };
  return { cookie, id: me.id };
}

// --- 1. Identity -----------------------------------------------------------

it("tells two cookie jars apart as two different visitors", async () => {
  const a = await freshVisitor();
  const b = await freshVisitor();
  expect(a.id, "two separate cookie jars were resolved to the same visitor").not.toBe(b.id);
});

it("keeps a visitor's id across requests with the same cookie", async () => {
  const visitor = await freshVisitor();
  const again = (await (await fetch(url("/api/me"), { headers: { cookie: visitor.cookie } }))
    .json()) as { id: string };
  expect(again.id, "the same cookie resolved to a different visitor on a later request").toBe(
    visitor.id,
  );
});

it("rejects a cookie whose signature has been tampered with", async () => {
  const visitor = await freshVisitor();

  // The cookie is `<id>.<signature>`; flip one character deep inside the
  // signature so it still looks well-formed but no longer verifies.
  const [name, rest] = visitor.cookie.split("=");
  const dot = rest.lastIndexOf(".");
  const id = rest.slice(0, dot);
  const mac = rest.slice(dot + 1);
  const flippedChar = mac[5] === "A" ? "B" : "A";
  const tampered = `${name}=${id}.${mac.slice(0, 5)}${flippedChar}${mac.slice(6)}`;

  const res = await fetch(url("/api/me"), { headers: { cookie: tampered } });
  const body = (await res.json()) as { id: string };
  expect(
    body.id,
    "a tampered cookie must not be honoured as the original visitor",
  ).not.toBe(id);

  // Confirm the swap did not simply land on someone else's real traces either:
  // the state behind the tampered cookie must not carry the original visitor's trace.
  await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: visitor.cookie },
    body: JSON.stringify({ body: "only the real visitor should ever see this" }),
  });
  const seenWithTampered = (await (await fetch(url("/api/state"), {
    headers: { cookie: tampered },
  })).json()) as { traces: { mine?: boolean; body: string }[] };
  const mineUnderTamperedCookie = seenWithTampered.traces
    .filter((trace) => trace.mine)
    .map((trace) => trace.body);
  expect(
    mineUnderTamperedCookie,
    "a tampered cookie must not inherit the original visitor's traces as 'mine'",
  ).not.toContain("only the real visitor should ever see this");
});

// --- 2. POST /api/act both ways --------------------------------------------

it("answers a JSON POST /api/act with JSON", async () => {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ body: "a json-posted trace" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = await res.json();
  expect(body).toHaveProperty("traces");
});

it("answers a form-encoded POST /api/act with a 303 to /", async () => {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body: "a form-posted trace" }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
});

it("refuses an empty body with a 4xx and a readable error, not a 500", async () => {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "" }),
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  const body = (await res.json()) as { error?: string };
  expect(typeof body.error, "an empty body must be refused with a readable error").toBe("string");
});

it("refuses a 281-character body with a 4xx and a readable error, not a 500", async () => {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "x".repeat(281) }),
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  const body = (await res.json()) as { error?: string };
  expect(typeof body.error, "an over-long body must be refused with a readable error").toBe(
    "string",
  );
});

it("refuses a non-JSON body with a 4xx and a readable error, not a 500", async () => {
  const res = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json at all",
  });
  expect(res.status, "a malformed JSON body reached the server as a 5xx").toBeGreaterThanOrEqual(
    400,
  );
  expect(res.status).toBeLessThan(500);
  const body = (await res.json()) as { error?: string };
  expect(typeof body.error, "a non-JSON body must be refused with a readable error").toBe(
    "string",
  );
});

// --- 3. /api/state marks only the caller's own traces as mine --------------

it("marks exactly the caller's own traces as mine in /api/state", async () => {
  const a = await freshVisitor();
  const b = await freshVisitor();

  const markerA = `trace belonging to visitor a ${Math.random()}`;
  const markerB = `trace belonging to visitor b ${Math.random()}`;

  await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ body: markerA }),
  });
  await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: b.cookie },
    body: JSON.stringify({ body: markerB }),
  });

  const seenByA = (await (await fetch(url("/api/state"), { headers: { cookie: a.cookie } }))
    .json()) as { traces: { id: number; mine?: boolean; body: string; visitor_id: string }[] };

  for (const trace of seenByA.traces) {
    expect(
      trace.mine === true,
      `trace ${trace.id} is marked mine=${trace.mine} but belongs to visitor ${trace.visitor_id}, caller is ${a.id}`,
    ).toBe(trace.visitor_id === a.id);
  }

  const mine = seenByA.traces.filter((trace) => trace.mine).map((trace) => trace.body);
  expect(mine).toContain(markerA);
  expect(mine).not.toContain(markerB);
});

// --- 4. /readme/ reflects an edit without a restart -------------------------
// (heading order & presence is invariants.test.ts's job; this proves liveness)

// Only meaningful when the app reads this checkout's README.md --- `pnpm dev`
// on a laptop. In CI the app is the built image, which carries its own copy
// of README.md: editing the runner's file can't reach it, and a redeploy is
// what changes the served README there. GitHub Actions sets CI=true.
it.skipIf(process.env.CI === "true")("reflects the current README.md content, read per request rather than cached", async () => {
  const fs = await import("node:fs/promises");
  const original = await fs.readFile("README.md", "utf8");
  const marker = `live-reload-probe-${Date.now()}`;
  try {
    await fs.writeFile("README.md", `${original}\n\n## ${marker}\n\nprobe body\n`);
    const res = await fetch(url("/readme/"));
    const html = await res.text();
    expect(
      html.includes(marker),
      "/readme/ did not reflect an edit to README.md without a restart",
    ).toBe(true);
  } finally {
    await fs.writeFile("README.md", original);
  }
});

// --- 5. Method and path discipline ------------------------------------------

it("answers GET /api/act with 405 and an Allow header", async () => {
  const res = await fetch(url("/api/act"), { method: "GET" });
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBeTruthy();
});

it("answers an unknown path with 404", async () => {
  const res = await fetch(url("/this/path/does/not/exist"));
  expect(res.status).toBe(404);
});

it("does not let /static/ requests escape public/", async () => {
  for (const attempt of [
    "/static/../src/server.ts",
    "/static/..%2f..%2fsrc%2fserver.ts",
    "/static/%2e%2e/%2e%2e/src/server.ts",
  ]) {
    const res = await fetch(url(attempt));
    expect(
      res.status,
      `${attempt} must not escape public/ (got ${res.status})`,
    ).not.toBe(200);
  }
});

// --- 6. /healthz -------------------------------------------------------------

it("answers /healthz without requiring a cookie", async () => {
  const res = await fetch(url("/healthz"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
  expect(
    res.headers.getSetCookie(),
    "/healthz must not hand out a visitor cookie",
  ).toEqual([]);
});

// --- 7. GET /api/events opens an SSE stream and replays missed events -------

it("opens an SSE stream with the right content-type", async () => {
  const controller = new AbortController();
  const res = await fetch(url("/api/events"), { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  controller.abort();
});

it("replays missed events when given a Last-Event-ID", async () => {
  // Record an event by acting as a known visitor, then reconnect claiming to
  // have already seen everything up to (but not including) it.
  const visitor = await freshVisitor();
  const marker = `event-replay-probe-${Math.random()}`;

  // The cursor is an *event* id. Trace ids count something else --- every
  // toggle, edit and rename is an event but not a new trace --- so a cursor
  // derived from them falls further behind the more the database is used,
  // until the replay's 200-event page ends before the event being looked for.
  const before = await (await fetch(url("/api/state"))).json() as {
    meta: { latestEvent: number };
  };
  const priorMaxId = before.meta.latestEvent;

  const acted = await fetch(url("/api/act"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: visitor.cookie },
    body: JSON.stringify({ body: marker }),
  });
  expect(acted.status).toBe(200);

  const controller = new AbortController();
  const res = await fetch(url("/api/events"), {
    headers: { "last-event-id": String(priorMaxId) },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);

  const reader = res.body?.getReader();
  expect(reader, "the SSE response has no readable body").toBeTruthy();

  let received = "";
  const found = await Promise.race([
    (async () => {
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        received += Buffer.from(value).toString("utf8");
        if (received.includes(marker)) return true;
      }
      return false;
    })(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  controller.abort();

  expect(
    found,
    `reconnecting with Last-Event-ID did not replay the missed event (saw: ${received.slice(0, 300)})`,
  ).toBe(true);
});
