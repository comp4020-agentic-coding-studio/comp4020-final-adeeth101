// "Multi-user" in the brief means the app tells people apart: two browsers are
// two visitors. No passwords --- a visitor is a signed cookie and a handle they
// can change. The signature stops someone handing themselves another visitor's
// id and inheriting their traces.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db, now, setting } from "./db.ts";

const COOKIE = "visitor";

// Kept on the volume, not in memory: a secret generated per boot invalidates
// every cookie on restart, and Fly stops this machine whenever nobody is
// using it. VISITOR_SECRET overrides it, so the secret can be rotated or
// shared without touching the database.
const secret = process.env.VISITOR_SECRET ?? setting("visitor_secret", () => randomUUID());

const sign = (id: string): string =>
  createHmac("sha256", secret).update(id).digest("base64url");

function verify(value: string): string | null {
  const cut = value.lastIndexOf(".");
  if (cut <= 0) return null;
  const [id, mac] = [value.slice(0, cut), value.slice(cut + 1)];
  const expected = sign(id);
  if (mac.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? id : null;
}

export type Visitor = { id: string; handle: string; fresh: boolean };

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const cut = part.indexOf("=");
    if (cut <= 0) continue;
    // Other sites' cookies on the same host can be malformed; one of them
    // must not turn every request into a 500. A cookie that won't decode is
    // ignored, like one that isn't there.
    try {
      out.set(part.slice(0, cut).trim(), decodeURIComponent(part.slice(cut + 1).trim()));
    } catch {
      continue;
    }
  }
  return out;
}

// Handles are shown next to other people's work, so they're short, plain, and
// never empty --- an unnamed visitor gets a readable fallback, not a blank.
// 32 x 32 names. A crit room holds twenty-odd people, and with the 64 names
// this list started with, two of them sharing one was more likely than not.
const ADJECTIVES = [
  "quiet", "slow", "far", "late", "near", "dim", "odd", "spare",
  "bright", "low", "warm", "cold", "soft", "loud", "brief", "deep",
  "faint", "loose", "plain", "quick", "round", "sharp", "still", "thin",
  "wide", "wild", "young", "pale", "blue", "green", "amber", "grey",
];
const NOUNS = [
  "lamp", "tide", "stair", "field", "wire", "glass", "path", "bell",
  "drum", "reed", "string", "horn", "loop", "beat", "chord", "echo",
  "fern", "moth", "kite", "stone", "river", "cloud", "ember", "harbour",
  "orbit", "pulse", "signal", "valley", "willow", "comet", "lantern", "meadow",
];

// Derived from the id rather than drawn at random, so a visitor who hasn't
// written anything yet --- and so has no row to keep a handle in --- still
// sees the same name on every page load.
const suggestHandle = (id: string): string => {
  const digest = createHmac("sha256", "handle").update(id).digest();
  return `${ADJECTIVES[digest[0] % ADJECTIVES.length]} ${NOUNS[digest[1] % NOUNS.length]}`;
};

export const cleanHandle = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const handle = raw.replace(/\s+/g, " ").trim().slice(0, 24);
  return handle.length > 0 ? handle : null;
};

const selectVisitor = db.prepare("select id, handle from visitor where id = ?");
const insertVisitor = db.prepare(
  "insert or ignore into visitor (id, handle, created_at, last_seen_at) values (?, ?, ?, ?)",
);
const touchVisitor = db.prepare("update visitor set last_seen_at = ? where id = ?");
const renameVisitor = db.prepare("update visitor set handle = ? where id = ?");

// Resolves the visitor for a request without writing anything. A browser that
// only looks --- a crawler, an uptime check, someone who leaves straight away
// --- never sends the cookie back, so creating a row per look would fill the
// table with people who were never there. The row is made by persist(), on
// the first write. `fresh` tells the caller to send the cookie.
export function identify(cookieHeader: string | undefined): Visitor {
  const raw = parseCookies(cookieHeader).get(COOKIE);
  const id = raw ? verify(raw) : null;

  if (id) {
    const row = selectVisitor.get(id) as { id: string; handle: string } | undefined;
    if (row) {
      touchVisitor.run(now(), id);
      return { id: row.id, handle: row.handle, fresh: false };
    }
    // Signed, but not yet written anything (or the volume was wiped): trust
    // the id, so a returning browser keeps it.
    return { id, handle: suggestHandle(id), fresh: false };
  }

  const made = randomUUID();
  return { id: made, handle: suggestHandle(made), fresh: true };
}

// Makes the visitor real before their first write. Safe to call on every
// write: a visitor who already has a row is left alone.
export function persist(visitor: Visitor): void {
  insertVisitor.run(visitor.id, visitor.handle, now(), now());
}

export function rename(visitor: Visitor, handle: string): void {
  persist(visitor);
  renameVisitor.run(handle, visitor.id);
}

// Each visitor has one track, addressed by their id rather than their handle:
// handles are short and can repeat, and two people called "odd glass" must
// not end up fighting over one track. The server derives it, so it is also
// the only track a visitor may start.
export const trackOf = (visitorId: string): string => `t-${visitorId.slice(0, 12)}`;

// A year, so "come back later" means later, not this afternoon. HttpOnly: the
// signed value *is* the visitor's identity, so no script on the page --- and
// the page plays other people's patterns --- gets to read it. Secure whenever
// the request arrived over HTTPS (Fly's proxy says so); a laptop on plain
// http still works.
export const cookieHeader = (visitor: Visitor, secure = false): string =>
  `${COOKIE}=${encodeURIComponent(`${visitor.id}.${sign(visitor.id)}`)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${
    secure ? "; Secure" : ""
  }`;
