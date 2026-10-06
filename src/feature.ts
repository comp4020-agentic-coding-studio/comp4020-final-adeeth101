// The seam the concept lives behind. Everything else in src/ --- storage,
// identity, the event log, the server, /readme/ --- is the same whatever this
// app turns out to be, so the concept is confined to this one file and the
// agent working on it never touches the others.
//
// What's here now is the floor, not the idea: a visitor leaves one piece of
// text and finds it again later. That already satisfies the week 9 spec line
// ("a stranger can visit, do the core thing, and find their trace still
// there"), which means the deploy can be proved end to end before the concept
// is finished, and a half-built idea can never leave the app dead.
import { db, now } from "./db.ts";
import { record } from "./events.ts";
import type { Visitor } from "./identity.ts";

export type Trace = {
  id: number;
  visitor_id: string;
  handle: string;
  slot: string | null;
  body: string;
  created_at: number;
  updated_at: number;
  mine?: boolean;
};

export type State = {
  you: { id: string; handle: string };
  traces: Trace[];
  // Whatever the concept needs the page to know that isn't a trace: whose turn
  // it is, how many slots are free, whether the chain is open.
  meta: Record<string, unknown>;
};

const listTraces = db.prepare(
  `select t.id, t.visitor_id, t.slot, t.body, t.created_at, t.updated_at, v.handle
     from trace t join visitor v on v.id = t.visitor_id
    order by t.updated_at desc
    limit 200`,
);
const mineInSlot = db.prepare("select id from trace where visitor_id = ? and slot is ?");
const insertTrace = db.prepare(
  `insert into trace (visitor_id, slot, body, created_at, updated_at)
   values (?, ?, ?, ?, ?) returning id`,
);
const updateTrace = db.prepare("update trace set body = ?, updated_at = ? where id = ?");

export function state(visitor: Visitor): State {
  const traces = (listTraces.all() as unknown as Trace[]).map((trace) => ({
    ...trace,
    mine: trace.visitor_id === visitor.id,
  }));
  return {
    you: { id: visitor.id, handle: visitor.handle },
    traces,
    meta: { count: traces.length },
  };
}

// The result shape is deliberately plain: `ok` decides the HTTP status, and
// `error` is shown to the person, so a refusal is part of the design rather
// than a 500. The rule a concept enforces (one track each, one link at a time,
// never your own line) is refused here.
export type ActResult = { ok: true; state: State } | { ok: false; error: string; status: number };

export function act(visitor: Visitor, input: Record<string, unknown>): ActResult {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length === 0) return { ok: false, error: "Write something first.", status: 400 };
  if (body.length > 280) {
    return { ok: false, error: "Keep it under 280 characters.", status: 400 };
  }

  const slot = typeof input.slot === "string" && input.slot.length > 0 ? input.slot : null;
  const existing = mineInSlot.get(visitor.id, slot) as { id: number } | undefined;

  if (existing) {
    updateTrace.run(body, now(), existing.id);
    record(visitor.id, "trace.updated", { id: existing.id, slot, body });
  } else {
    const { id } = insertTrace.get(visitor.id, slot, body, now(), now()) as { id: number };
    record(visitor.id, "trace.created", { id, slot, body });
  }

  return { ok: true, state: state(visitor) };
}
