export const COURSE_URL = "https://course.lwastuargo.com/se-career";
export const MIN_HTML_LENGTH = 20_000;

export type Status = "CLOSED" | "ANNOUNCED" | "OPEN";
export type SchemeState = "closed" | "not-yet-open" | "open";

export interface Scheme {
  id: string;
  title: string;
  state: SchemeState;
  opensAt: string | null;
  endedButOpening: boolean;
}

export type Observation =
  | {
      kind: "ok";
      at: number;
      status: Status;
      opensAt: string | null;
      schemes: Scheme[];
      endedButOpening: boolean;
    }
  | { kind: "shape"; at: number; reason: string }
  | { kind: "fetch"; at: number; reason: string }
  | { kind: "skip"; at: number };

const CHUNK_START = "self.__next_f.push([1,";
const SCHEME_START = '"priceScheme":[';

function fail(reason: string): never {
  throw new Error(reason);
}

function stringEnd(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return fail("unterminated string");
}

function joinChunks(html: string): string {
  let joined = "";
  let count = 0;
  for (let i = html.indexOf(CHUNK_START); i >= 0; ) {
    const open = i + CHUNK_START.length;
    if (html[open] !== '"') {
      i = html.indexOf(CHUNK_START, open);
      continue;
    }
    const end = stringEnd(html, open);
    joined += JSON.parse(html.slice(open, end + 1));
    count++;
    i = html.indexOf(CHUNK_START, end);
  }
  if (count === 0) fail("no __next_f chunks");
  return joined;
}

function extractSchemes(joined: string): unknown[] {
  const start = joined.indexOf(SCHEME_START);
  if (start < 0) fail("no priceScheme");
  if (joined.indexOf(SCHEME_START, start + 1) >= 0) fail("more than one priceScheme");
  const open = start + SCHEME_START.length - 1;
  let depth = 0;
  for (let i = open; i < joined.length; i++) {
    const c = joined[i];
    if (c === '"') i = stringEnd(joined, i);
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      const schemes = JSON.parse(joined.slice(open, i + 1));
      if (!Array.isArray(schemes) || schemes.length === 0) fail("empty priceScheme");
      return schemes;
    }
  }
  return fail("unterminated priceScheme");
}

interface Button {
  label: string;
  disabled: boolean;
}

function extractButtons(html: string): Button[] {
  const buttons: Button[] = [];
  for (let b = html.indexOf("<button"); b >= 0; b = html.indexOf("<button", b + 1)) {
    const a = html.lastIndexOf("<a ", b);
    if (a < 0 || html.indexOf("<", a + 1) !== b || html[b - 1] !== ">") continue;
    const tagEnd = html.indexOf(">", b);
    const close = html.indexOf("</button>", tagEnd);
    if (tagEnd < 0 || close < 0) fail("unterminated button");
    const attrs = html.slice(b, tagEnd).replace(/"[^"]*"/g, "");
    buttons.push({
      label: html
        .slice(tagEnd + 1, close)
        .replace(/<[^>]*>/g, "")
        .trim(),
      disabled: /\sdisabled(?![\w:-])/.test(attrs),
    });
  }
  return buttons;
}

function field<T>(
  obj: Record<string, unknown>,
  key: string,
  type: "string" | "boolean" | "number",
) {
  const value = obj[key];
  if (typeof value !== type) fail(`field ${key} missing or mistyped`);
  return value as T;
}

function date(value: unknown, key: string): number | null {
  if (value === null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) fail(`field ${key} is not a date`);
  return ms;
}

function readScheme(raw: unknown, now: number): Scheme {
  if (typeof raw !== "object" || raw === null) fail("scheme is not an object");
  const o = raw as Record<string, unknown>;
  const id = field<string>(o, "cuid", "string");
  const title = field<string>(o, "title", "string");
  const endEnabled = field<boolean>(o, "isFirstPaymentEndDateEnabled", "boolean");
  const quotaEnabled = field<boolean>(o, "isQuotaEnabled", "boolean");
  const quotaMax = field<number>(o, "quotaMax", "number");
  const quotaUsed = field<number>(o, "quotaUsed", "number");
  if (!("firstPaymentEndDate" in o)) fail("field firstPaymentEndDate missing");
  if (!("openingDate" in o)) fail("field openingDate missing");
  const end = date(o.firstPaymentEndDate, "firstPaymentEndDate");
  const opening = date(o.openingDate, "openingDate");
  if (endEnabled && end === null) fail("field firstPaymentEndDate is not a date");

  const closed =
    (endEnabled && (end as number) < now) ||
    (quotaEnabled && Math.max(quotaMax - quotaUsed, 0) <= 0);
  const upcoming = opening !== null && opening > now;
  const state: SchemeState = closed ? "closed" : upcoming ? "not-yet-open" : "open";
  return {
    id,
    title,
    state,
    opensAt: upcoming ? new Date(opening).toISOString() : null,
    endedButOpening: closed && upcoming,
  };
}

const EXPECTED_LABEL: Record<SchemeState, string | null> = {
  closed: "Tutup",
  "not-yet-open": "Belum dibuka",
  open: null,
};

function summarize(html: string, now: number, at: number): Observation {
  const raw = extractSchemes(joinChunks(html));
  const schemes = raw.map((r) => readScheme(r, now));
  const buttons = extractButtons(html);
  if (buttons.length !== schemes.length) {
    fail(`${buttons.length} buttons for ${schemes.length} schemes`);
  }
  schemes.forEach((scheme, i) => {
    const { label, disabled } = buttons[i];
    const expected = EXPECTED_LABEL[scheme.state];
    if (disabled !== (scheme.state !== "open") || (expected !== null && label !== expected)) {
      fail(`button "${label}" disagrees with data for scheme ${scheme.id}`);
    }
  });

  const upcoming = schemes
    .filter((s) => s.state === "not-yet-open")
    .map((s) => s.opensAt as string)
    .sort();
  const status: Status = schemes.some((s) => s.state === "open")
    ? "OPEN"
    : upcoming.length > 0
      ? "ANNOUNCED"
      : "CLOSED";
  return {
    kind: "ok",
    at,
    status,
    opensAt: status === "ANNOUNCED" ? upcoming[0] : null,
    schemes,
    endedButOpening: schemes.some((s) => s.endedButOpening),
  };
}

export async function detect(res: Response, at: number): Promise<Observation> {
  if (res.status === 429 || res.status === 503) return { kind: "skip", at };
  if (res.status >= 500) return { kind: "fetch", at, reason: `HTTP ${res.status}` };
  try {
    if (res.status !== 200) fail(`HTTP ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) fail("not HTML");
    const now = Date.parse(res.headers.get("date") ?? "");
    if (Number.isNaN(now)) fail("no Date header");
    const html = await res.text();
    if (html.length < MIN_HTML_LENGTH) fail(`page too short (${html.length})`);
    return summarize(html, now, at);
  } catch (e) {
    return { kind: "shape", at, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
