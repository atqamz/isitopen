import { COURSE_URL } from "./detect";
import type { State } from "./step";
import { ago, STALE_AFTER_MS, wibDay, wibTime } from "./time";

const REPO_URL = "https://github.com/atqamz/isitopen";

const CSS = `
:root{--paper:#f6f3ec;--ink:#1d1d1b;--muted:#5c5a53;--closed:#a4372a;--announced:#8a5a00;--open:#0f7a55;--unknown:#5c5a53}
@media (prefers-color-scheme:dark){:root{--paper:#14130f;--ink:#efece3;--muted:#a7a499;--closed:#e98a78;--announced:#e3a846;--open:#4fc79b;--unknown:#a7a499}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:40rem;margin:0 auto;padding:2rem 1rem 3rem}
.q{margin:0;color:var(--muted)}
.hero{margin:.25rem 0 1rem;font-size:clamp(4.5rem,20vw,12rem);font-weight:900;line-height:.9;letter-spacing:-.04em;text-transform:uppercase}
.closed{color:var(--closed)}.announced{color:var(--announced)}.open{color:var(--open)}.unknown{color:var(--unknown)}
.checked{margin:0 0 2rem}
.stale{color:var(--announced);font-weight:600}
.go{display:inline-block;padding:.75rem 1.25rem;border:2px solid var(--ink);color:var(--ink);font-weight:700;text-decoration:none}
.go:hover,.go:focus-visible{background:var(--ink);color:var(--paper)}
footer{margin-top:3rem;color:var(--muted);font-size:.875rem}
footer a{color:inherit}
`;

function hero(state: State | null): { text: string; cls: string } {
  if (state?.status === "OPEN") return { text: "OPEN", cls: "open" };
  if (state?.status === "ANNOUNCED" && state.opensAt) {
    return { text: `OPENS ${wibDay(Date.parse(state.opensAt)).toUpperCase()}`, cls: "announced" };
  }
  if (state?.status === "CLOSED") return { text: "CLOSED", cls: "closed" };
  return { text: "UNKNOWN", cls: "unknown" };
}

function checked(state: State | null, now: number): string {
  if (state?.checkedAt == null) return "Not checked yet.";
  const age = now - state.checkedAt;
  const text = `Last checked ${ago(age)} (${wibTime(state.checkedAt)} WIB)`;
  return age > STALE_AFTER_MS ? `${text} <span class="stale">checker may be stale</span>` : text;
}

export function renderPage(state: State | null, now: number): string {
  const { text, cls } = hero(state);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Is SE Career open?</title>
<meta name="description" content="Unofficial status of the SE Career course registration.">
<style>${CSS}</style>
</head>
<body>
<main>
<p class="q">Is the SE Career course open?</p>
<h1 class="hero ${cls}">${text}</h1>
<p class="checked">${checked(state, now)}</p>
<a class="go" href="${COURSE_URL}">Open the real course page</a>
<footer>
<p>Unofficial. Not affiliated with @lwastuargo or the course.</p>
<p><a href="${REPO_URL}">Source on GitHub</a></p>
</footer>
</main>
</body>
</html>
`;
}
