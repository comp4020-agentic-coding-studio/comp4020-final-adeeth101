// spec/invariants.test.ts requires README.md's headings to appear, in order, in
// the HTML served at /readme/ --- no script runs, so it has to be in the body.
// A small renderer keeps the app dependency-free; it handles the subset this
// project's README actually uses, and falls back to a paragraph otherwise.
const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline spans, innermost first so a link's text can still carry emphasis.
function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function render(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: "ul" | "ol" | null = null;
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length > 0) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: copied verbatim, and nothing inside it is markdown.
    const fence = line.match(/^ {0,3}(```|~~~)(.*)$/);
    if (fence) {
      flushAll();
      const body: string[] = [];
      const marker = fence[1];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(marker); i++) body.push(lines[i]);
      const lang = fence[2].trim();
      out.push(
        `<pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${escape(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2];
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      continue;
    }

    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const bullet = line.match(/^ {0,3}[-*+]\s+(.*)$/);
    const number = line.match(/^ {0,3}\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      flushParagraph();
      flushQuote();
      const want = bullet ? "ul" : "ol";
      if (list !== want) {
        flushList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((bullet ?? number)![1])}</li>`);
      continue;
    }

    const quoted = line.match(/^ {0,3}>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    // A list item or quote wrapping onto the next line continues it.
    if (list && /^\s+\S/.test(line)) {
      out.push(out.pop()!.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
      continue;
    }
    if (quote.length > 0) {
      quote.push(line.trim());
      continue;
    }

    paragraph.push(line.trim());
  }

  flushAll();
  return out.join("\n");
}
