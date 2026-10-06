// Enhancement only. Without this file the grid and the editor still work as
// plain form posts. With it: saves happen without a reload (a reload would cut
// the music off mid-bar), other people's changes arrive as they happen, and
// the room can be heard.
//
// Sound is evaluated here, in this browser, and never on the server. Strudel
// is fetched only when someone presses play, so a visitor who just looks
// downloads nothing from a third party.

const STRUDEL = "https://unpkg.com/@strudel/web@1.3.0/dist/index.js";
const SAMPLES = "github:tidalcycles/dirt-samples";

const $ = (selector, root = document) => root.querySelector(selector);

// --- Saving without a reload -------------------------------------------

const say = (message) => {
  const status = $("[data-status]");
  if (status) status.textContent = message;
};

// Re-render from what the server now holds rather than guessing locally, so
// the page always shows what the volume has. Only the two regions are
// swapped: the sound controls, and whatever is playing, survive.
async function refresh() {
  const res = await fetch("/", { headers: { accept: "text/html" } });
  if (!res.ok) return;
  const next = new DOMParser().parseFromString(await res.text(), "text/html");
  const focused = document.activeElement;
  const keep = focused?.closest?.("[data-grid]") ? focused.getAttribute("value") : null;
  const typing = focused?.id === "body";

  for (const region of document.querySelectorAll("[data-region]")) {
    const name = region.getAttribute("data-region");
    const fresh = next.querySelector(`[data-region="${name}"]`);
    if (!fresh) continue;
    // Never pull the text out from under someone mid-edit.
    if (name === "yours" && typing) continue;
    region.replaceWith(fresh);
  }
  if (keep !== null) $(`[data-grid] [value="${keep}"]`)?.focus();
  if (playing) play();
}

async function send(data) {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That didn't save.");
}

// One listener on the document, so it keeps working after a region is
// swapped for a fresh copy.
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.matches("[data-grid], [data-compose]")) return;
  event.preventDefault();

  const data = Object.fromEntries(new FormData(form));
  // A grid button submits its own step; FormData leaves the submitter out.
  if (form.matches("[data-grid]")) data.step = Number(event.submitter?.value);

  if (form.matches("[data-compose]")) say("saving…");
  try {
    await send(data);
    if (form.matches("[data-compose]")) say("saved");
    if (form.matches("[data-compose]")) document.activeElement?.blur();
    await refresh();
  } catch (error) {
    if (error instanceof TypeError) {
      // The network failed, not the server: hand over to the plain form
      // post, which works without any of this.
      say("offline — submitting the slow way");
      form.submit();
      return;
    }
    say(error.message);
  }
});

// Other people's changes. The server already streams every change; a burst
// of them becomes one refresh.
let pending = null;
try {
  const events = new EventSource("/api/events");
  for (const kind of ["trace.created", "trace.updated"]) {
    events.addEventListener(kind, () => {
      clearTimeout(pending);
      pending = setTimeout(refresh, 150);
    });
  }
} catch {
  /* no live updates; saving still works */
}

// --- Sound ----------------------------------------------------------------

const transport = $("[data-transport]");
transport?.removeAttribute("hidden");
const status = (message) => {
  const el = $("[data-audio-status]");
  if (el) el.textContent = message;
};

let strudel = null;
let loading = null;
let playing = false;

function load() {
  if (strudel) return Promise.resolve(strudel);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRUDEL;
    script.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("timed out")), 20000);
    script.onload = async () => {
      clearTimeout(timer);
      try {
        const api = window.strudel;
        await window.initStrudel({ prebake: () => api.samples(SAMPLES) });
        strudel = api;
        resolve(api);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("couldn't be fetched"));
    };
    document.head.append(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

// What plays: every track the grid understands (its code can only be
// `s("...")` with plain names, so it can't do anything but make sound), plus
// your own, plus other people's hand-written code only if you've said so ---
// Strudel runs code as JavaScript, and someone else's code runs in your
// browser.
function selection() {
  const others = $("[data-others]")?.checked;
  const codes = [];
  let skipped = 0;
  for (const li of document.querySelectorAll(".trace[data-slot]")) {
    if (!li.dataset.slot) continue; // a note, not a track
    const code = $(".trace__body", li)?.textContent?.trim();
    if (!code) continue;
    if (li.dataset.kind === "pattern" || li.dataset.mine === "true" || others) codes.push(code);
    else skipped++;
  }
  return { codes, skipped };
}

async function play() {
  const { codes, skipped } = selection();
  if (codes.length === 0) {
    status("Nothing to play yet. Press a step to start your track.");
    return;
  }
  try {
    await strudel.evaluate(`stack(${codes.join(",\n")})`);
  } catch (error) {
    // One person's broken code shouldn't silence the room: fall back to the
    // tracks the grid can vouch for.
    const safe = [...document.querySelectorAll('.trace[data-kind="pattern"]')]
      .map((li) => $(".trace__body", li)?.textContent?.trim())
      .filter(Boolean);
    if (safe.length > 0) await strudel.evaluate(`stack(${safe.join(",\n")})`).catch(() => {});
    status(`Some code didn't run (${error.message}). Playing the patterns that did.`);
    return;
  }
  status(
    `Playing ${codes.length} ${codes.length === 1 ? "track" : "tracks"}` +
      (skipped ? `, leaving out ${skipped} of other people's hand-written code.` : "."),
  );
}

$("[data-play]")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (playing) {
    strudel?.hush();
    playing = false;
    button.textContent = "Play";
    button.setAttribute("aria-pressed", "false");
    status("Stopped.");
    return;
  }
  status("Loading sound…");
  try {
    await load();
  } catch (error) {
    status(`Sound is unavailable (${error.message}). Everything else still works.`);
    return;
  }
  playing = true;
  button.textContent = "Stop";
  button.setAttribute("aria-pressed", "true");
  await play();
});

$("[data-others]")?.addEventListener("change", () => {
  if (playing) play();
});
