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
import { latestEventId, record } from "./events.ts";
import { trackOf, type Visitor } from "./identity.ts";
import { parse, print, type Pattern } from "./pattern.ts";

export type Trace = {
  id: number;
  visitor_id: string;
  handle: string;
  slot: string | null;
  body: string;
  created_at: number;
  updated_at: number;
  mine?: boolean;
  // The grid is a view over `body`, not a second source of truth --- see
  // src/pattern.ts. `steps` is null, and `editable` false, whenever `body`
  // falls outside the one subset the grid understands. The page shows the
  // code with no grid in that case; it never rewrites someone's text.
  editable: boolean;
  steps: Pattern["steps"] | null;
};

export type State = {
  you: { id: string; handle: string };
  traces: Trace[];
  // Whatever the concept needs the page to know that isn't a trace: whose turn
  // it is, how many slots are free, whether the chain is open.
  meta: Record<string, unknown>;
};

// Newest track first, by when it was started, not last changed: ordering by
// the last change moved a track to the top on every press, so following one
// collaborator meant chasing them around the room.
const listTraces = db.prepare(
  `select t.id, t.visitor_id, t.slot, t.body, t.created_at, t.updated_at, v.handle
     from trace t join visitor v on v.id = t.visitor_id
    order by t.created_at desc, t.id desc
    limit 200`,
);
const mineInSlot = db.prepare(
  "select id, body from trace where visitor_id = ? and slot is ?",
);
const ownerOfSlot = db.prepare(
  "select visitor_id from trace where slot = ? and slot is not null limit 1",
);
const insertTrace = db.prepare(
  `insert into trace (visitor_id, slot, body, created_at, updated_at)
   values (?, ?, ?, ?, ?) returning id`,
);
const updateTrace = db.prepare("update trace set body = ?, updated_at = ? where id = ?");

function withPattern(trace: Trace): Trace {
  const pattern = parse(trace.body);
  // A bar longer than the grid can edit is still valid code, so it stays code:
  // showing forty buttons and refusing a press on the fortieth would promise an
  // edit the server won't make.
  const fits = pattern !== null && pattern.steps.length <= MAX_STEPS;
  return { ...trace, editable: fits, steps: fits ? pattern.steps : null };
}

const ownTraces = db.prepare(
  `select t.id, t.visitor_id, t.slot, t.body, t.created_at, t.updated_at, v.handle
     from trace t join visitor v on v.id = t.visitor_id
    where t.visitor_id = ?`,
);

export function state(visitor: Visitor): State {
  const room = listTraces.all() as unknown as Trace[];
  // The room shows the latest 200, but your own track must never fall off
  // the end of that: a returning visitor whose track had gone quiet would
  // otherwise open the page to an empty editor, though the track was saved.
  const seen = new Set(room.map((t) => t.id));
  const own = (ownTraces.all(visitor.id) as unknown as Trace[]).filter((t) => !seen.has(t.id));
  const traces = [...room, ...own].map((trace) =>
    withPattern({ ...trace, mine: trace.visitor_id === visitor.id }),
  );
  return {
    you: { id: visitor.id, handle: visitor.handle },
    traces,
    meta: { count: traces.length, latestEvent: latestEventId() },
  };
}

// The result shape is deliberately plain: `ok` decides the HTTP status, and
// `error` is shown to the person, so a refusal is part of the design rather
// than a 500. The rule a concept enforces (one track each, one link at a time,
// never your own line) is refused here.
export type ActResult = { ok: true; state: State } | { ok: false; error: string; status: number };

// One track per visitor: a named slot is a track, and only the visitor who
// already owns it may write to it again. A slot of null is the pre-concept
// shared scratch space and keeps its old, unowned behaviour untouched ---
// nothing in docs/contract.md names a track yet, so that path stays as it was.
// A bar is at most this many steps. The bound is what stops a single toggle
// with an enormous index from allocating an array the size of the machine.
export const MAX_STEPS = 32;

// The length of a new track's bar.
export const BAR = 16;

// The same shape src/pattern.ts accepts as a step, kept short enough that a
// full bar still fits the 280-character limit on a track.
const SOUND_NAME = /^[a-zA-Z][a-zA-Z0-9]{0,7}$/;

// The kit a step cycles through: a rest, then each of these in turn.
export const KIT = ["bd", "sd", "hh", "cp"] as const;

const next = (sound: string | null): string | null => {
  if (sound === null) return KIT[0];
  const at = (KIT as readonly string[]).indexOf(sound);
  return at === -1 || at === KIT.length - 1 ? null : KIT[at + 1];
};

export function act(visitor: Visitor, input: Record<string, unknown>): ActResult {
  const slot = typeof input.slot === "string" && input.slot.length > 0 ? input.slot : null;

  if (slot !== null) {
    if (slot.length > 64) return { ok: false, error: "That isn't a track.", status: 400 };
    const owner = ownerOfSlot.get(slot) as { visitor_id: string } | undefined;
    if (owner && owner.visitor_id !== visitor.id) {
      return { ok: false, error: "That track belongs to someone else.", status: 403 };
    }
    // Ownership has to hold for the first write too, not only once a track
    // exists: otherwise anyone could start the track reserved for someone who
    // hasn't written yet, and that person's own first press would be refused.
    // A visitor may start exactly one track, the one derived from their id.
    // Tracks they already own under another name stay theirs to edit.
    if (!owner && slot !== trackOf(visitor.id)) {
      return { ok: false, error: "You can only start your own track.", status: 403 };
    }
  }

  const existing = mineInSlot.get(visitor.id, slot) as { id: number; body: string } | undefined;

  let body: string;
  if (input.step !== undefined) {
    // A grid toggle: edit one step of the track's own pattern. A plain form
    // post sends every field as a string, so a step of "3" is read as 3 ---
    // that is what lets the grid work with no script at all.
    const step = typeof input.step === "string" && /^\d{1,3}$/.test(input.step)
      ? Number(input.step)
      : input.step;
    if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step >= MAX_STEPS) {
      return { ok: false, error: `A step is a whole number from 0 to ${MAX_STEPS - 1}.`, status: 400 };
    }

    // Hand-written code the grid can't read is never overwritten by it: the
    // grid would have to throw the code away to make room for a blank bar,
    // and the person who wrote it would find their work replaced by a click.
    // In Strudel the number of steps is the length of the bar, so a new track
    // starts as a whole bar of rests: a first click on step 12 shouldn't make
    // a 13-step bar.
    const parsed = existing ? parse(existing.body) : { steps: Array<null>(BAR).fill(null) };
    const current = parsed && parsed.steps.length <= MAX_STEPS ? parsed : null;
    if (current === null) {
      return {
        ok: false,
        error: "This track is hand-written code, so it can only be edited as text.",
        status: 409,
      };
    }

    const steps = [...current.steps];
    while (steps.length <= step) steps.push(null);

    // No sound given means "the next one": a step button cycles through the
    // kit, which is what a grid with one control per step needs. A sound
    // given (or null, for a rest) sets it outright.
    let sound: unknown;
    if (!("sound" in input)) sound = next(steps[step]);
    else sound = input.sound === null || input.sound === "" ? null : input.sound;
    if (sound !== null && (typeof sound !== "string" || !SOUND_NAME.test(sound))) {
      return { ok: false, error: "A sound is a short name of letters and digits, like bd.", status: 400 };
    }

    steps[step] = sound;
    body = print({ steps });
  } else {
    body = typeof input.body === "string" ? input.body.trim() : "";
  }

  if (body.length === 0) return { ok: false, error: "Write something first.", status: 400 };
  if (body.length > 280) {
    return { ok: false, error: "Keep it under 280 characters.", status: 400 };
  }

  if (existing) {
    updateTrace.run(body, now(), existing.id);
    record(visitor.id, "trace.updated", { id: existing.id, slot, body });
  } else {
    const { id } = insertTrace.get(visitor.id, slot, body, now(), now()) as { id: number };
    record(visitor.id, "trace.created", { id, slot, body });
  }

  return { ok: true, state: state(visitor) };
}
