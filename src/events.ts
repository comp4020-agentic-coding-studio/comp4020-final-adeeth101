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
const sinceEvents = db.prepare(
  "select id, visitor_id, kind, payload, created_at from event where id > ? order by id limit 200",
);

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
): Event {
  const at = now();
  const body = JSON.stringify(payload);
  const { id } = insertEvent.get(visitorId, kind, body, at) as { id: number };
  const event: Event = { id, visitor_id: visitorId, kind, payload: body, created_at: at };
  for (const listener of listeners) {
    // One broken subscriber must not stop the others, or lose the write.
    try {
      listener(event);
    } catch {
      /* dropped: the stream is a courtesy, the log is the truth */
    }
  }
  return event;
}

export const since = (id: number): Event[] => sinceEvents.all(id) as Event[];

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

  const send = (event: Event): void => {
    res.write(`id: ${event.id}\nevent: ${event.kind}\ndata: ${event.payload}\n\n`);
  };

  for (const missed of since(lastEventId)) send(missed);

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
