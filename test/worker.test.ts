import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { renderPage } from "../src/page";
import { type State, step } from "../src/step";
import announced from "./fixtures/se-career.announced.html?raw";
import closed from "./fixtures/se-career.closed.html?raw";
import open from "./fixtures/se-career.open.html?raw";
import { MINUTE, NOW, ok, respond } from "./helpers";

const KEY = "se-career";
const TUESDAY = Date.parse("2026-11-10T06:00:00.000Z");
const send = vi.fn();
const testEnv = {
  ...env,
  MAIL: { send },
  EMAIL_FROM: "alert@example.com",
  EMAIL_TO: "me@example.org",
} as unknown as Env;

const store = (state: State) => testEnv.STATE.put(KEY, JSON.stringify(state));
const load = () => testEnv.STATE.get<State>(KEY, "json") as Promise<State>;
const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://isitopen.test${path}`, init) as never, testEnv);
const cron = () => worker.scheduled?.({} as never, testEnv);
const serve = (...pages: (Response | Error)[]) => {
  const fetchMock = vi.fn();
  for (const page of pages) {
    if (page instanceof Error) fetchMock.mockRejectedValueOnce(page);
    else fetchMock.mockResolvedValueOnce(page);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const dated = (html: string) => respond(html, { date: new Date(TUESDAY).toUTCString() });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  send.mockReset().mockResolvedValue(undefined);
  await testEnv.STATE.delete(KEY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("redirects / to /se-career", async () => {
    const res = await get("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://isitopen.test/se-career");
  });

  it.each(["/other", "/se-career/", "/se-career/x", "/robots.txt"])("404s %s", async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  it("404s non-GET methods", async () => {
    expect((await get("/se-career", { method: "POST" })).status).toBe(404);
  });

  it("serves the page cacheable for 60 s", async () => {
    const res = await get("/se-career");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("page", () => {
  const at = TUESDAY - 7 * MINUTE;
  const page = (status: "CLOSED" | "ANNOUNCED" | "OPEN") =>
    renderPage(step(null, ok(status, at)).next, TUESDAY);

  it("shows CLOSED", () => {
    expect(page("CLOSED")).toContain('class="hero closed">CLOSED<');
  });

  it("shows OPENS 12 DEC", () => {
    expect(page("ANNOUNCED")).toContain('class="hero announced">OPENS 12 DEC<');
  });

  it("shows OPEN", () => {
    expect(page("OPEN")).toContain('class="hero open">OPEN<');
  });

  it("shows when nothing was checked yet", () => {
    const html = renderPage(null, TUESDAY);
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("Not checked yet.");
  });

  it("shows the age of the last check in WIB", () => {
    expect(page("CLOSED")).toContain("Last checked 7 min ago (12:53 WIB)");
    expect(page("CLOSED")).not.toContain("may be stale");
  });

  it("flags a checker stale after 1 h", () => {
    const state = step(null, ok("CLOSED", TUESDAY - 61 * MINUTE)).next;
    expect(renderPage(state, TUESDAY)).toContain("checker may be stale");
    const fresh = step(null, ok("CLOSED", TUESDAY - 60 * MINUTE)).next;
    expect(renderPage(fresh, TUESDAY)).not.toContain("may be stale");
  });

  it("links the course, carries the disclaimer, and has no script or form", () => {
    const html = page("CLOSED");
    expect(html).toContain('href="https://course.lwastuargo.com/se-career"');
    expect(html).toContain("Unofficial. Not affiliated with @lwastuargo or the course.");
    expect(html).not.toMatch(/<script|<form|<input/i);
  });

  it("renders stored state through the route", async () => {
    await store(step(null, ok("OPEN", TUESDAY)).next);
    expect(await (await get("/se-career")).text()).toContain(">OPEN<");
  });
});

describe("scheduled", () => {
  it("fetches with the checker user agent and manual redirects", async () => {
    const fetchMock = serve(dated(closed));
    await cron();
    expect(fetchMock).toHaveBeenCalledWith("https://course.lwastuargo.com/se-career", {
      headers: {
        "User-Agent": "isitopen.atqamz.com status checker (+https://isitopen.atqamz.com)",
      },
      redirect: "manual",
    });
  });

  it("records the first run without mail", async () => {
    serve(dated(closed));
    await cron();
    expect(send).not.toHaveBeenCalled();
    expect(await load()).toMatchObject({ status: "CLOSED", checkedAt: TUESDAY });
  });

  it("mails once when the course opens and not again on repeat runs", async () => {
    serve(dated(closed), dated(open), dated(open), dated(open));
    await cron();
    await cron();
    await cron();
    await cron();
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.from).toBe("alert@example.com");
    expect(message.to).toBe("me@example.org");
    expect((await load()).pending).toEqual([]);
  });

  it("mails the opening date when announced", async () => {
    serve(dated(closed), dated(announced));
    await cron();
    await cron();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await load()).opensAt).toBe("2026-12-12T03:00:00.000Z");
  });

  it("keeps a failed mail and retries it on the next run", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    serve(dated(closed), dated(open), dated(open), dated(open));
    await cron();
    send.mockRejectedValueOnce(new Error("down"));
    await cron();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await load()).pending).toHaveLength(1);
    await cron();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await load()).pending).toEqual([]);
    await cron();
    expect(send).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("counts a network error as a fetch failure", async () => {
    serve(new Error("boom"));
    await cron();
    expect(await load()).toMatchObject({ fetchFails: 1, status: null });
  });

  it("counts a broken page as a shape error and alerts on the second", async () => {
    serve(dated("<html></html>"), dated("<html></html>"));
    await cron();
    expect(send).not.toHaveBeenCalled();
    await cron();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await load()).toMatchObject({ shapeFails: 2, alerted: true });
  });

  it("changes nothing on 503", async () => {
    serve(dated(closed), respond("", { status: 503 }));
    await cron();
    const before = await load();
    await cron();
    expect(await load()).toEqual(before);
  });

  it("sends the Monday heartbeat once", async () => {
    vi.setSystemTime(NOW);
    serve(respond(closed), respond(closed));
    await cron();
    await cron();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
