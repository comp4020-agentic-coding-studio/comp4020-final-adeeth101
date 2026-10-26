// The append-only log, plus the fan-out that week 10 ("a change one person
// makes appears in every other open session within about a second") is built
// on. Tonight nothing has to be live, so the log is written now and the stream
// is already here to read it --- the real-time crit becomes a client change,
// not a rewrite.
import type { ServerResponse } from "node:http";
import { db, now } from "./db.ts";

const insertEvent = db.prepare(
  "insert into event (visitor_id, kind, payload, created_at) values (?, ?, ?, ?) returning id",
);
// The event table is shared with project rooms, whose events are private to
// their members. This stream is the sketchpad's own, and is public, so it reads
// only the sketchpad's kinds: anything else written to the table stays out of it.
export const LEGACY_KINDS = ["trace.created", "trace.updated", "visitor.renamed"] as const;
// Prepared on first use: project_id is added by the studio migration, which
// runs after this module loads.
let sinceEvents: ReturnType<typeof db.prepare> | null = null;
const sinceQuery = () => (sinceEvents ??= db.prepare(
  `select id, visitor_id, kind, payload, created_at from event
    where id > ? and project_id is null and kind in (${LEGACY_KINDS.map(() => "?").join(",")})
    order by id limit 200`,
));

export type Event = {
  id: number;
  visitor_id: string | null;
  kind: string;
  payload: string;
  created_at: number;
};

const listeners = new Set<(event: Event) => void>();

// Every state change goes through here, so there is exactly one place that
// knows a change happened --- which is what makes the stream complete rather
// than a best effort.
export function record(
  visitorId: string | null,
  kind: string,
  payload: Record<string, unknown> = {},
  broadcast = true,
): Event {
  const at = now();
  const body = JSON.stringify(payload);
  const { id } = insertEvent.get(visitorId, kind, body, at) as { id: number };
  const event: Event = { id, visitor_id: visitorId, kind, payload: body, created_at: at };
  if (broadcast) publish(event);
  return event;
}

const handleOf = db.prepare("select handle from visitor where id = ?");

// One JSON line per action on stdout, which is what `flyctl logs` shows: who
// (handle and short id) did what. Called only once a change has committed, or
// for a refusal, so the log never names a change that rolled back. Clip source
// and trace bodies stay out: the log says who, not what they wrote.
export function logAction(
  who: { id: string; handle?: string } | null,
  kind: string,
  fields: Record<string, unknown> = {},
  level: "info" | "warn" = "info",
): void {
  const handle = who ? (who.handle ?? (handleOf.get(who.id) as { handle: string } | undefined)?.handle) : "system";
  console.log(JSON.stringify({ at: Date.now(), level, who: handle ?? "unsaved visitor", visitor: who?.id.slice(0, 8) ?? null, kind, ...fields }));
}

export function publish(event: Event): void {
  const { id } = JSON.parse(event.payload) as { id?: unknown };
  logAction(event.visitor_id ? { id: event.visitor_id } : null, event.kind, { event: event.id, ...(id !== undefined ? { entity: id } : {}) });
  for (const listener of listeners) {
    // One broken subscriber must not stop the others, or lose the write.
    try {
      listener(event);
    } catch {
      /* dropped: the stream is a courtesy, the log is the truth */
    }
  }
}

export const since = (id: number): Event[] => sinceQuery().all(id, ...LEGACY_KINDS) as Event[];

const newest = db.prepare("select coalesce(max(id), 0) as id from event");

// The id a page was rendered at. A browser that opens the stream from here
// gets only what changed after it loaded, rather than a replay of history it
// already has on screen.
export const latestEventId = (): number => (newest.get() as { id: number }).id;

// Server-sent events: one long-lived GET, no protocol upgrade, and it survives
// Fly's proxy without extra configuration. `Last-Event-ID` lets a reconnecting
// browser replay what it missed, which is why the log is the source.
export function stream(res: ServerResponse, lastEventId: number): () => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Node holds the headers back until the first write. A browser that opens
  // the stream with nothing to replay --- which is every page load, now that
  // a page asks only for what's new --- would otherwise wait up to the first
  // heartbeat, twenty seconds, before it even knows the stream is open.
  res.write(": open\n\n");

  const send = (event: Event): void => {
    res.write(`id: ${event.id}\nevent: ${event.kind}\ndata: ${event.payload}\n\n`);
  };

  // since() reads 200 at a time; keep reading until caught up, or a browser
  // that was away for more than 200 changes gets a partial replay and then
  // silence. Synchronous, so nothing recorded meanwhile can slip between the
  // backlog and the live subscription below.
  let cursor = lastEventId;
  for (;;) {
    const batch = since(cursor);
    for (const missed of batch) send(missed);
    if (batch.length < 200) break;
    cursor = batch[batch.length - 1].id;
  }

  listeners.add(send);

  // Fly stops an idle machine, and a silent connection looks idle. A comment
  // every 20s keeps it open and tells a proxy the stream is alive.
  const beat = setInterval(() => res.write(": beat\n\n"), 20_000);

  const close = (): void => {
    clearInterval(beat);
    listeners.delete(send);
  };
  res.on("close", close);
  return close;
}

export const openStreams = (): number => listeners.size;
