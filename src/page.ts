// Server-rendered HTML. The page is whole before any script runs, which is
// what makes the app survive a slow connection, a blocked script and a reload
// mid-action --- the "holds up under use it wasn't designed for" band. app.js
// enhances it; it is never required.
import type { State } from "./feature.ts";

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

export function page(state: State, notice?: string): string {
  const traces = state.traces
    .map(
      (trace) => `<li class="trace${trace.mine ? " trace--mine" : ""}">
  <p class="trace__body">${escape(trace.body)}</p>
  <p class="trace__by">${escape(trace.handle)}${trace.mine ? " <span>(you)</span>" : ""}
    <time datetime="${when(trace.updated_at)}">${when(trace.updated_at).slice(0, 16).replace("T", " ")}</time></p>
</li>`,
    )
    .join("\n");

  return shell(
    "It's alive",
    `<header class="bar">
  <h1>Still here</h1>
  <p class="bar__you">you are <strong data-handle>${escape(state.you.handle)}</strong></p>
  <nav><a href="/readme/">What good means</a></nav>
</header>

<main id="main">
  ${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ""}

  <!-- Posts without JS too: the form is a real form, and the server answers a
       plain submit with the rebuilt page. -->
  <form class="compose" method="post" action="/api/act" data-compose>
    <label for="body">Leave something here</label>
    <textarea id="body" name="body" rows="3" maxlength="280" required
      placeholder="Anything. You'll find it again when you come back."></textarea>
    <p class="compose__row">
      <button type="submit">Leave it</button>
      <span class="compose__hint" data-status role="status"></span>
    </p>
  </form>

  <h2>${state.traces.length} ${state.traces.length === 1 ? "mark" : "marks"} so far</h2>
  <ul class="traces" data-traces>
${traces || '    <li class="empty">Nothing yet. Yours would be the first.</li>'}
  </ul>
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
