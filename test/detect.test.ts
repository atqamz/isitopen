import { describe, expect, it } from "vitest";
import { detect } from "../src/detect";
import announced from "./fixtures/se-career.announced.html?raw";
import closed from "./fixtures/se-career.closed.html?raw";
import endedOpening from "./fixtures/se-career.ended-opening-set.html?raw";
import open from "./fixtures/se-career.open.html?raw";
import quotaFull from "./fixtures/se-career.quota-full.html?raw";
import {
  CLOSED_BUTTON,
  NOW,
  NOW_ISO,
  OPEN_BUTTON,
  respond,
  UPCOMING_BUTTON,
  variant,
} from "./helpers";

const run = (html: string, init?: Parameters<typeof respond>[1]) =>
  detect(respond(html, init), NOW);
const twoOf = (button: string) => [button, button];
const dates =
  (opening: string | null, end: string | null) => (schemes: Record<string, unknown>[]) => {
    for (const s of schemes) {
      s.openingDate = opening;
      s.isFirstPaymentEndDateEnabled = end !== null;
      s.firstPaymentEndDate = end;
    }
  };
const FUTURE = "2027-01-31T16:59:00.000Z";

describe("status rules", () => {
  it("reads the real closed page as CLOSED", async () => {
    const obs = await run(closed);
    expect(obs).toMatchObject({ kind: "ok", status: "CLOSED", opensAt: null });
    if (obs.kind !== "ok") throw new Error();
    expect(obs.schemes.map((s) => s.state)).toEqual(["closed", "closed"]);
    expect(obs.schemes.map((s) => s.title)).toEqual(["Full payment", "Cicilan 3 bulan"]);
  });

  it("reads ANNOUNCED with the opening date", async () => {
    expect(await run(announced)).toMatchObject({
      status: "ANNOUNCED",
      opensAt: "2026-12-12T03:00:00.000Z",
    });
  });

  it("reads OPEN", async () => {
    expect(await run(open)).toMatchObject({ kind: "ok", status: "OPEN" });
  });

  it("ignores quota that is disabled even when used exceeds max", async () => {
    expect(await run(closed)).toMatchObject({ status: "CLOSED" });
    const html = variant((s) => {
      dates(null, FUTURE)(s);
      for (const x of s) x.quotaUsed = 500;
    }, twoOf(OPEN_BUTTON));
    expect(await run(html)).toMatchObject({ status: "OPEN" });
  });

  it("reads a full quota as CLOSED", async () => {
    expect(await run(quotaFull)).toMatchObject({ status: "CLOSED" });
  });

  it("keeps ended-but-opening-set CLOSED and flags it", async () => {
    expect(await run(endedOpening)).toMatchObject({
      status: "CLOSED",
      opensAt: null,
      endedButOpening: true,
    });
  });

  it("treats quota left as open", async () => {
    const html = variant((s) => {
      dates(null, FUTURE)(s);
      for (const x of s) Object.assign(x, { isQuotaEnabled: true, quotaMax: 100, quotaUsed: 99 });
    }, twoOf(OPEN_BUTTON));
    expect(await run(html)).toMatchObject({ status: "OPEN" });
  });

  it("is OPEN when any scheme is open", async () => {
    const html = variant(
      (s) => {
        dates(null, FUTURE)(s);
        s[0].isFirstPaymentEndDateEnabled = true;
        s[0].firstPaymentEndDate = "2026-01-01T00:00:00.000Z";
      },
      [CLOSED_BUTTON, OPEN_BUTTON],
    );
    expect(await run(html)).toMatchObject({ status: "OPEN" });
  });

  it("is ANNOUNCED with the earliest date when none is open", async () => {
    const html = variant((s) => {
      dates("2026-12-20T03:00:00.000Z", FUTURE)(s);
      s[1].openingDate = "2026-12-12T03:00:00.000Z";
    }, twoOf(UPCOMING_BUTTON));
    expect(await run(html)).toMatchObject({
      status: "ANNOUNCED",
      opensAt: "2026-12-12T03:00:00.000Z",
    });
  });

  it("is ANNOUNCED when one scheme is closed and one not yet open", async () => {
    const html = variant(
      (s) => {
        dates("2026-12-12T03:00:00.000Z", FUTURE)(s);
        s[0].isFirstPaymentEndDateEnabled = true;
        s[0].firstPaymentEndDate = "2026-01-01T00:00:00.000Z";
      },
      [CLOSED_BUTTON, UPCOMING_BUTTON],
    );
    expect(await run(html)).toMatchObject({ status: "ANNOUNCED" });
  });
});

describe("boundaries", () => {
  it("opens when openingDate == now", async () => {
    const html = variant(dates(NOW_ISO, FUTURE), twoOf(OPEN_BUTTON));
    expect(await run(html)).toMatchObject({ status: "OPEN" });
  });

  it("is not yet open when openingDate is 1 ms after now", async () => {
    const html = variant(dates(new Date(NOW + 1).toISOString(), FUTURE), twoOf(UPCOMING_BUTTON));
    expect(await run(html)).toMatchObject({ status: "ANNOUNCED" });
  });

  it("is still open when the end date == now", async () => {
    const html = variant(dates(null, NOW_ISO), twoOf(OPEN_BUTTON));
    expect(await run(html)).toMatchObject({ status: "OPEN" });
  });

  it("is closed when the end date is 1 ms before now", async () => {
    const html = variant(dates(null, new Date(NOW - 1).toISOString()), twoOf(CLOSED_BUTTON));
    expect(await run(html)).toMatchObject({ status: "CLOSED" });
  });

  it("uses the Date header as now", async () => {
    const later = new Date(NOW + 1000).toUTCString();
    const html = variant(dates(NOW_ISO, FUTURE), twoOf(OPEN_BUTTON));
    expect(await run(html, { date: later })).toMatchObject({ status: "OPEN" });
    const early = new Date(NOW - 5000).toUTCString();
    const upcoming = variant(dates(NOW_ISO, FUTURE), twoOf(UPCOMING_BUTTON));
    expect(await run(upcoming, { date: early })).toMatchObject({ status: "ANNOUNCED" });
  });
});

describe("fetch results", () => {
  it("skips 429 and 503", async () => {
    expect(await run(closed, { status: 429 })).toMatchObject({ kind: "skip" });
    expect(await run(closed, { status: 503 })).toMatchObject({ kind: "skip" });
  });

  it("reports other 5xx as a fetch failure", async () => {
    expect(await run("", { status: 500 })).toMatchObject({ kind: "fetch", reason: "HTTP 500" });
    expect(await run("", { status: 502 })).toMatchObject({ kind: "fetch" });
  });
});

describe("shape errors", () => {
  const shapeOf = async (html: string, init?: Parameters<typeof respond>[1]) => {
    const obs = await run(html, init);
    expect(obs.kind).toBe("shape");
    return obs.kind === "shape" ? obs.reason : "";
  };
  const badScheme = (edit: (s: Record<string, unknown>) => void) =>
    variant((s) => edit(s[0]), twoOf(CLOSED_BUTTON));

  it.each([
    ["404", { status: 404 }],
    ["redirect", { status: 302 }],
    ["non-HTML", { type: "application/json" }],
    ["no Date header", { date: "" }],
  ])("rejects %s", async (_name, init) => {
    await shapeOf(closed, init);
  });

  it("rejects a page under 20 KB", async () => {
    const res = new Response(closed, { headers: { "Content-Type": "text/html", Date: NOW_ISO } });
    expect(await detect(res, NOW)).toMatchObject({ kind: "shape" });
  });

  it("rejects a page without chunks", async () => {
    expect(await shapeOf(closed.replace(/<script>.*<\/script>/g, ""))).toContain("chunks");
  });

  it("rejects a page without priceScheme", async () => {
    expect(await shapeOf(closed.replaceAll("priceScheme", "priceSchemes"))).toContain(
      "no priceScheme",
    );
  });

  it("rejects an empty priceScheme", async () => {
    const html = variant((s) => s.splice(0), []);
    expect(await shapeOf(html)).toContain("empty");
  });

  it("rejects unparseable priceScheme JSON", async () => {
    await shapeOf(closed.replace('\\"cuid\\":\\"cmjf4jl5k0001l704smf8fu46\\"', '\\"cuid\\":'));
  });

  it("rejects a renamed required field", async () => {
    const html = badScheme((s) => {
      s.isQuotaEnabledX = s.isQuotaEnabled;
      delete s.isQuotaEnabled;
    });
    expect(await shapeOf(html)).toContain("isQuotaEnabled");
  });

  it("rejects a mistyped field", async () => {
    expect(
      await shapeOf(
        badScheme((s) => {
          s.quotaMax = "100";
        }),
      ),
    ).toContain("quotaMax");
  });

  it("rejects a missing opening date key", async () => {
    expect(
      await shapeOf(
        badScheme((s) => {
          delete s.openingDate;
        }),
      ),
    ).toContain("openingDate");
  });

  it("rejects an invalid date", async () => {
    expect(
      await shapeOf(
        badScheme((s) => {
          s.openingDate = "soon";
        }),
      ),
    ).toContain("openingDate");
  });

  it("rejects an enabled end date that is null", async () => {
    expect(
      await shapeOf(
        badScheme((s) => {
          s.firstPaymentEndDate = null;
        }),
      ),
    ).toContain("firstPaymentEndDate");
  });

  it("rejects a button count that differs from the scheme count", async () => {
    expect(await shapeOf(closed.replace(CLOSED_BUTTON, ""))).toContain("buttons");
  });

  it("rejects an enabled button on closed data", async () => {
    expect(await shapeOf(variant(() => {}, twoOf(OPEN_BUTTON)))).toContain("disagrees");
  });

  it("rejects a disabled button on open data", async () => {
    const html = variant(dates(null, FUTURE), twoOf(CLOSED_BUTTON));
    expect(await shapeOf(html)).toContain("disagrees");
  });

  it("rejects an unexpected label on a disabled button", async () => {
    const html = variant(() => {}, twoOf(CLOSED_BUTTON.replace(">Tutup<", ">Habis<")));
    expect(await shapeOf(html)).toContain("disagrees");
  });
});

describe("markup", () => {
  it("ignores buttons that are not inside an anchor", async () => {
    const html = closed.replace("<body>", "<body><button>Daftar</button>");
    expect(await run(html)).toMatchObject({ status: "CLOSED" });
  });
});
