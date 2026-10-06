// Server-rendered HTML. The page is whole before any script runs: the grid's
// steps are real form buttons and the code editor is a real form, so making
// and changing a track works on a slow connection, a blocked script or a
// reload mid-action --- the "holds up under use it wasn't designed for" band.
// public/app.js adds sound and saves without a reload; it is never required.
import type { State, Trace } from "./feature.ts";

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${body}
</body>
</html>
`;

const when = (at: number): string => new Date(at).toISOString();

// Words for the kit, so a screen reader says "kick", not "b d".
const NAMES: Record<string, string> = { bd: "kick", sd: "snare", hh: "hat", cp: "clap" };
const named = (sound: string | null): string => (sound === null ? "rest" : NAMES[sound] ?? sound);

// Each visitor has one track, addressed by their id rather than their handle:
// handles are short and can repeat, and two people called "odd glass" must
// not end up fighting over one track.
export const trackOf = (visitorId: string): string => `t-${visitorId.slice(0, 12)}`;

const BAR = 16;

// The editable grid for your own track. Every step is a submit button posting
// only its index; the server cycles that step to the next sound. One hidden
// field names the track.
function grid(slot: string, steps: (string | null)[]): string {
  const cells = (steps.length > 0 ? steps : Array<null>(BAR).fill(null))
    .map(
      (sound, i) =>
        `<button type="submit" name="step" value="${i}" class="step${sound ? ` step--${escape(sound)}` : ""}"
      aria-pressed="${sound !== null}" aria-label="Step ${i + 1}: ${escape(named(sound))}. Press to change">${
          sound ? escape(sound) : "·"
        }</button>`,
    )
    .join("\n    ");
  return `<form class="grid" method="post" action="/api/act" data-grid>
    <input type="hidden" name="slot" value="${escape(slot)}" aria-label="Your track">
    ${cells}
  </form>`;
}

// Somebody else's grid: the same shape, but nothing to press.
const readonlyGrid = (steps: (string | null)[]): string =>
  `<p class="grid grid--readonly" aria-hidden="true">${steps
    .map((sound) => `<span class="step${sound ? ` step--${escape(sound)}` : ""}">${sound ? escape(sound) : "·"}</span>`)
    .join("")}</p>`;

function track(trace: Trace): string {
  const kind = trace.editable ? "pattern" : "code";
  const note = trace.editable
    ? ""
    : `<p class="trace__note">${
        trace.mine
          ? "Hand-written code, so it's edited as text."
          : "Hand-written code. It plays only if you allow other people's code below."
      }</p>`;
  return `<li class="trace${trace.mine ? " trace--mine" : ""}" data-slot="${escape(trace.slot ?? "")}"
    data-kind="${kind}" data-mine="${trace.mine ? "true" : "false"}">
  <p class="trace__by">${escape(trace.handle)}${trace.mine ? " <span>(you)</span>" : ""}
    <time datetime="${when(trace.updated_at)}">${when(trace.updated_at).slice(0, 16).replace("T", " ")}</time></p>
  ${trace.editable && trace.steps ? readonlyGrid(trace.steps) : ""}
  <pre class="trace__body"><code>${escape(trace.body)}</code></pre>
  ${note}
</li>`;
}

export function page(state: State, notice?: string, draft?: string): string {
  const slot = trackOf(state.you.id);
  const mine = state.traces.find((t) => t.mine && t.slot === slot);
  const handWritten = mine !== undefined && !mine.editable;
  const code = draft ?? mine?.body ?? "";

  const tracks = state.traces.map(track).join("\n");
  const count = state.traces.length;

  return shell(
    "A shared Strudel space",
    `<header class="bar">
  <h1>A shared Strudel space</h1>
  <p class="bar__you">you are <strong data-handle>${escape(state.you.handle)}</strong></p>
  <nav><a href="/readme/">What good means</a></nav>
</header>

<main id="main">
  ${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ""}

  <!-- Sound needs a script, so the controls for it arrive with one. -->
  <section class="transport" data-transport hidden aria-label="Sound">
    <button type="button" data-play aria-pressed="false">Play</button>
    <span class="transport__opt"><input type="checkbox" id="others" data-others>
      <label for="others">Also play other people's hand-written code</label></span>
    <p class="transport__status" data-audio-status aria-live="polite">Sound loads when you press play.</p>
  </section>

  <section id="yours" data-region="yours">
    <h2>Your track</h2>
    ${
      handWritten
        ? `<p class="hint">Your track is code the grid can't read, so the grid stays out of its way.
      Write a pattern like <code>s("bd ~ sd ~")</code> to get the grid back.</p>`
        : `<p class="hint">Press a step to cycle it through kick, snare, hat, clap and rest.
      The code below changes with it.</p>
    ${grid(slot, mine?.steps ?? [])}`
    }

    <form class="compose" method="post" action="/api/act" data-compose>
      <input type="hidden" name="slot" value="${escape(slot)}" aria-label="Your track">
      <label for="body">Your track as Strudel code</label>
      <textarea id="body" name="body" rows="3" maxlength="280" required spellcheck="false"
        placeholder='s("bd ~ sd ~ bd bd sd ~")'>${escape(code)}</textarea>
      <p class="compose__row">
        <button type="submit">Save code</button>
        <span class="compose__hint" data-status role="status"></span>
      </p>
    </form>
  </section>

  <section id="room" data-region="room">
    <h2>${count} ${count === 1 ? "track" : "tracks"} in the room</h2>
    <ul class="traces" data-traces>
${tracks || '    <li class="empty">Nobody has made a track yet. Yours would be the first.</li>'}
    </ul>
  </section>
</main>

<script type="module" src="/static/app.js"></script>`,
  );
}

export const readmePage = (body: string): string =>
  shell(
    "What good means",
    `<header class="bar"><h1>What good means</h1><nav><a href="/">Back to the app</a></nav></header>
<main id="main" class="prose">
${body}
</main>`,
  );
