// Enhancement only. Everything below already works as a plain form post; this
// just avoids the reload and is where week 10's live updates will arrive.
const form = document.querySelector("[data-compose]");
const status = document.querySelector("[data-status]");

const say = (message) => {
  if (status) status.textContent = message;
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const body = textarea.value.trim();
  if (!body) return;

  say("saving…");
  try {
    const res = await fetch("/api/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) return say(data.error ?? "that didn't save");
    textarea.value = "";
    say("saved — it'll be here when you come back");
    // Re-render from the server's state rather than guessing locally, so what
    // the page shows is always what the volume holds.
    location.reload();
  } catch {
    // A failed fetch must not swallow the person's text: fall back to the real
    // form post, which works without any of this.
    say("offline — submitting the slow way");
    form.submit();
  }
});
