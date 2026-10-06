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
    if (cut > 0) out.set(part.slice(0, cut).trim(), decodeURIComponent(part.slice(cut + 1).trim()));
  }
  return out;
}

// Handles are shown next to other people's work, so they're short, plain, and
// never empty --- an unnamed visitor gets a readable fallback, not a blank.
const ADJECTIVES = ["quiet", "slow", "far", "late", "near", "dim", "odd", "spare"];
const NOUNS = ["lamp", "tide", "stair", "field", "wire", "glass", "path", "bell"];

const suggestHandle = (): string =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${
    NOUNS[Math.floor(Math.random() * NOUNS.length)]
  }`;

export const cleanHandle = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const handle = raw.replace(/\s+/g, " ").trim().slice(0, 24);
  return handle.length > 0 ? handle : null;
};

const selectVisitor = db.prepare("select id, handle from visitor where id = ?");
const insertVisitor = db.prepare(
  "insert into visitor (id, handle, created_at, last_seen_at) values (?, ?, ?, ?)",
);
const touchVisitor = db.prepare("update visitor set last_seen_at = ? where id = ?");
const renameVisitor = db.prepare("update visitor set handle = ? where id = ?");

// Resolves the visitor for a request, creating one if this browser is new.
// `fresh` tells the caller to send the cookie back.
export function identify(cookieHeader: string | undefined): Visitor {
  const raw = parseCookies(cookieHeader).get(COOKIE);
  const id = raw ? verify(raw) : null;

  if (id) {
    const row = selectVisitor.get(id) as { id: string; handle: string } | undefined;
    if (row) {
      touchVisitor.run(now(), id);
      return { id: row.id, handle: row.handle, fresh: false };
    }
    // Signed cookie for a visitor the volume no longer has: trust the id and
    // rebuild the row, so a wiped database doesn't orphan a returning browser.
    const handle = suggestHandle();
    insertVisitor.run(id, handle, now(), now());
    return { id, handle, fresh: false };
  }

  const made = randomUUID();
  const handle = suggestHandle();
  insertVisitor.run(made, handle, now(), now());
  return { id: made, handle, fresh: true };
}

export function rename(visitor: Visitor, handle: string): void {
  renameVisitor.run(handle, visitor.id);
}

// A year, so "come back later" means later, not this afternoon. Not httpOnly:
// nothing secret rides in it, and the page reads the handle for display.
export const cookieHeader = (visitor: Visitor): string =>
  `${COOKIE}=${encodeURIComponent(`${visitor.id}.${sign(visitor.id)}`)}; Path=/; Max-Age=31536000; SameSite=Lax`;
