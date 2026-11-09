import type { Observation, Scheme, SchemeState, Status } from "../src/detect";
import closedHtml from "./fixtures/se-career.closed.html?raw";

export const NOW = Date.parse("2026-11-09T13:45:00.000Z");
export const NOW_ISO = new Date(NOW).toISOString();
export const MINUTE = 60_000;

export function respond(
  html: string,
  { status = 200, type = "text/html; charset=utf-8", date = new Date(NOW).toUTCString() } = {},
): Response {
  const padded = `${html}<!--${"x".repeat(20_000)}-->`;
  const headers: Record<string, string> = { "Content-Type": type };
  if (date) headers.Date = date;
  return new Response(padded, { status, headers });
}

const CHUNK = /<script>self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g;
const ANCHOR = /<a [^>]*><button[^>]*>[^<]*<\/button><\/a>/;

export const button = (label: string, disabled: boolean): string =>
  (closedHtml.match(ANCHOR) as RegExpMatchArray)[0]
    .replace(' disabled=""', disabled ? ' disabled=""' : "")
    .replace(">Tutup<", `>${label}<`);

export const CLOSED_BUTTON = button("Tutup", true);
export const UPCOMING_BUTTON = button("Belum dibuka", true);
export const OPEN_BUTTON = button("Daftar", false);

type Raw = Record<string, unknown>;

export function variant(edit: (schemes: Raw[]) => void, buttons: string[]): string {
  const joined = [...closedHtml.matchAll(CHUNK)].map((m) => JSON.parse(m[1])).join("");
  const start = joined.indexOf('"priceScheme":') + '"priceScheme":'.length;
  const end = joined.indexOf(',"referral"');
  const schemes: Raw[] = JSON.parse(joined.slice(start, end));
  edit(schemes);
  const payload = joined.slice(0, start) + JSON.stringify(schemes) + joined.slice(end);
  return `<!DOCTYPE html><html><body>${buttons.join("")}<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
}

const SCHEME_STATE: Record<Status, SchemeState> = {
  CLOSED: "closed",
  ANNOUNCED: "not-yet-open",
  OPEN: "open",
};

export function ok(status: Status, at = NOW, extra: Partial<Observation> = {}): Observation {
  const state = SCHEME_STATE[status];
  const scheme = (id: string): Scheme => ({
    id,
    title: id === "a" ? "Full payment" : "Installment",
    state,
    opensAt: null,
    endedButOpening: false,
  });
  return {
    kind: "ok",
    at,
    status,
    opensAt: status === "ANNOUNCED" ? "2026-12-12T03:00:00.000Z" : null,
    schemes: [scheme("a"), scheme("b")],
    endedButOpening: false,
    ...extra,
  } as Observation;
}

export const shape = (at = NOW, reason = "no priceScheme"): Observation => ({
  kind: "shape",
  at,
  reason,
});
export const fetchFail = (at = NOW, reason = "HTTP 500"): Observation => ({
  kind: "fetch",
  at,
  reason,
});
export const skip = (at = NOW): Observation => ({ kind: "skip", at });
export const suspect = (
  status: "OPEN" | "ANNOUNCED",
  at = NOW,
  reason = "0 buttons for 2 schemes",
): Observation => ({
  kind: "shape",
  at,
  reason,
  data: { status, opensAt: status === "ANNOUNCED" ? "2026-12-12T03:00:00.000Z" : null },
});
