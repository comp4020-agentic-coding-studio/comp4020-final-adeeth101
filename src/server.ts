// The composition root: it owns the routing table and nothing else. Handlers
// live in their own modules, so several people can work at once without two of
// them editing the same file. Adding a route is the one change that belongs
// here.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./markdown.ts";
import { cleanHandle, cookieHeader, identify, persist, rename, type Visitor } from "./identity.ts";
import { act, state } from "./feature.ts";
import { record, stream } from "./events.ts";
import { page, readmePage } from "./page.ts";

const PORT = Number(process.env.PORT ?? 8080);
// fileURLToPath, not .pathname: a path with a space in it arrives
// percent-encoded otherwise, and every read of README.md or public/ fails.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const send = (
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void => {
  res.writeHead(status, { "content-type": type, ...extra });
  res.end(body);
};

const json = (res: ServerResponse, status: number, body: unknown, extra = {}): void =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), extra);

const html = (res: ServerResponse, status: number, body: string, extra = {}): void =>
  send(res, status, "text/html; charset=utf-8", body, extra);

// Bodies are small by design; anything larger is a mistake or an attack, and
// either way the app should not hold it in memory.
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");

  // A plain <form> post is form-encoded, and the no-JS path depends on it
  // being understood here exactly like the fetch path's JSON.
  if ((req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    throw new Error("body is not json");
  }
}

// A browser submitting a real form wants a page back, not JSON. Answering with
// a redirect also means a reload won't re-post the same text.
const wantsHtml = (req: IncomingMessage): boolean =>
  (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded") ||
  (!(req.headers.accept ?? "").includes("application/json") &&
    (req.headers.accept ?? "").includes("text/html"));

// Set on the first response to a new browser; sending it on every response
// would reset the year-long expiry for no reason.
const cookie = (visitor: Visitor): Record<string, string> =>
  visitor.fresh ? { "set-cookie": cookieHeader(visitor) } : {};

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  // normalize collapses '..' before anything is joined; a path that still
  // escapes public/ afterwards is refused rather than cleaned, so there is no
  // sanitiser to outsmart.
  const rel = normalize(pathname.replace(/^\/static\//, ""));
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  try {
    const body = await readFile(join(ROOT, "public", rel));
    send(res, 200, TYPES[extname(rel)] ?? "application/octet-stream", body, {
      "cache-control": "public, max-age=300",
    });
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  try {
    // Fly's health check, and the one route that touches neither the database
    // nor a cookie --- so it still answers when something else is broken.
    if (path === "/healthz") return json(res, 200, { ok: true });

    if (path.startsWith("/static/")) {
      if (await serveStatic(res, url.pathname)) return;
      return send(res, 404, "text/plain; charset=utf-8", "not found");
    }

    // README.md is read per request, not cached at boot: the spec compares the
    // served headings against the file on disk, and a stale copy fails it.
    if (path === "/readme") {
      const markdown = await readFile(join(ROOT, "README.md"), "utf8");
      return html(res, 200, readmePage(render(markdown)));
    }

    const visitor = identify(req.headers.cookie);

    if (path === "/") {
      return html(res, 200, page(state(visitor)), cookie(visitor));
    }

    if (path === "/api/me") return json(res, 200, visitor, cookie(visitor));

    if (path === "/api/state") {
      return json(res, 200, state(visitor), cookie(visitor));
    }

    if (path === "/api/events" && method === "GET") {
      const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0);
      stream(res, Number.isFinite(last) ? last : 0);
      return;
    }

    if (path === "/api/handle" && method === "POST") {
      const handle = cleanHandle((await readJson(req)).handle);
      if (!handle) return json(res, 400, { error: "A name needs at least one character." });
      rename(visitor, handle);
      record(visitor.id, "visitor.renamed", { handle });
      return json(res, 200, { ...visitor, handle }, cookie(visitor));
    }

    if (path === "/api/act" && method === "POST") {
      const input = await readJson(req);
      persist(visitor);
      const result = act(visitor, input);
      if (wantsHtml(req)) {
        if (result.ok) {
          res.writeHead(303, { location: "/", ...cookie(visitor) });
          return res.end();
        }
        // The refused text goes back into the editor: without a script there
        // is no other copy of it, and a refusal shouldn't cost someone what
        // they wrote.
        const draft = typeof input.body === "string" ? input.body : undefined;
        return html(res, result.status, page(state(visitor), result.error, draft), cookie(visitor));
      }
      return result.ok
        ? json(res, 200, result.state, cookie(visitor))
        : json(res, result.status, { error: result.error }, cookie(visitor));
    }

    // A GET to a POST-only route is a mistake worth naming, not a 404.
    if (["/api/act", "/api/handle"].includes(path)) {
      return json(res, 405, { error: `${path} wants POST` }, { allow: "POST" });
    }

    return html(res, 404, page(state(visitor), "There's nothing at that address."), cookie(visitor));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    // Logged here and nowhere else, so week 11's instruments have one seam to
    // widen rather than a scatter of console calls.
    console.error(JSON.stringify({ at: Date.now(), level: "error", path, method, message }));
    if (res.headersSent) return res.end();
    const client = message === "body too large" || message === "body is not json";
    return json(res, client ? 400 : 500, { error: client ? message : "something broke" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ at: Date.now(), level: "info", msg: `listening on ${PORT}` }));
});

// Fly stops the machine when nobody's using it: close cleanly so WAL is
// checkpointed and the next visitor doesn't open a half-written database.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
